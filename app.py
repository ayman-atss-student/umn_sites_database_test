import psycopg2 # For accessing PostgreSQL server
import psycopg2.extras
from flask import Flask, render_template, request, session, redirect, url_for, flash, jsonify

import csv # For pope tech merge 
import requests # For checking site status
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse

#Libraries below are for a locally-executed demo. Use UMN SSO in production
import getpass # PostgreSQL requires a password for database access, so this will be passed into the command line for demo. 
import re #hides the password input
import threading
import os # stores temporary password locally on user's machine 
import json # key value for timestamp and password
import tempfile # stores command line password input; not needed in production if SSO is implemented
import time #for password expiration timestamp

#Local server for demo, not to be used in production
app = Flask(__name__)
# dbHost = os.environ.get("DB_HOST") #"dpg-d1luqf6mcj7s73avju8g-a"
# dbName = os.environ.get("DB_NAME") #"umn_sites_database_test_oax2"
# dbUser = os.environ.get("DB_USER") #"umn_sites_database_test_oax2_user"
# dbPassword = os.environ.get("DB_PASSWORD")
DEPARTMENTS = [] #Initialize array for storing department names and queries
CONTACTS = [] #WEDAC contacts for each department
# File to temporarily store password
TEMP_PASSWORD_FILE = os.path.join(tempfile.gettempdir(), 'flask_db_password_temp')
# Password expiration time in seconds (30 minutes)
PASSWORD_EXPIRATION = 1800  # 30 minutes * 60 seconds

def get_db_password():
    """Get the database password, either from temp file or user input"""
    current_time = time.time()
    
    # Check if password is stored in temporary file and not expired
    if os.path.exists(TEMP_PASSWORD_FILE):
        try:
            with open(TEMP_PASSWORD_FILE, 'r') as f:
                data = json.load(f)
                password = data.get('password', '')
                timestamp = data.get('timestamp', 0)
                
                # Check if password has expired
                if current_time - timestamp <= PASSWORD_EXPIRATION:
                    # Test if password still works
                    try:
                        test_conn = psycopg2.connect(
                            database=dbName,
                            user=dbUser,
                            password=password,
                            host=dbHost,
                            port="5432"
                        )
                        test_conn.close()
                        return password
                    except psycopg2.OperationalError:
                        # Password no longer valid, will prompt again
                        pass
                else:
                    print("Password has expired. Please enter it again.")
        except Exception as e:
            # If any error occurs reading the file, ignore and prompt for password
            pass
    
    # If we get here, we need to prompt for password
    password = getpass.getpass("Enter database password (your connection will last 30 minutes before your password expires): ")
    
    # Test the connection to make sure password works
    try:
        test_conn = psycopg2.connect(
            database=dbName,
            user=dbUser,
            password=password,
            host=dbHost,
            port="5432"
        )
        test_conn.close()
        print("Database connection successful!")
        
        # Save password and timestamp to temporary file
        with open(TEMP_PASSWORD_FILE, 'w') as f:
            json.dump({
                'password': password,
                'timestamp': current_time
            }, f)
        
        # Set permissions to user read/write only
        try:
            os.chmod(TEMP_PASSWORD_FILE, 0o600)
        except:
            # If chmod fails, it's not critical
            pass
            
        return password
    except psycopg2.OperationalError as e:
        print(f"Error connecting to database: {e}")
        # If we get here, password was wrong, so we'll prompt again
        return get_db_password()  # Recursive call to try again

def get_db_connection():
    """Create and return database connection using the stored password. Host and port will be different in production"""
    db_url = os.environ.get("DATABASE_URL")
    return psycopg2.connect(db_url)
    # Return a new connection using the password
    # return psycopg2.connect(
    #     database=dbName,
    #     user=dbUser,
    #     password=dbPassword,
    #     host=dbHost,
    #     port="5432"
    # )

def populate(DEPARTMENTS):
    """
    Populate the DEPARTMENTS array based on public.drupal_sites_by_department table.

    Args:
        DEPARTMENTS (array): Array of dictionaries containing key-value pairs 
        to identify each department in the API calls and html form
    """
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('''SELECT DISTINCT department
            FROM public.drupal_sites_by_department 
            WHERE department IS NOT NULL
            ORDER BY drupal_sites_by_department.department
                ''')
    departments = cur.fetchall()
    department_names = []
    for department in departments:
        department_name = str(department)
        department_name = department_name[2:-3] #strip off quotes and commas
        department_names.append(department_name)
        #print(f'{department_name}\n') #debug
    # print(len(department_names)) #debug
    # cur.execute('''
    #     SELECT table_name FROM INFORMATION_SCHEMA.views 
    #     WHERE table_schema = ANY (current_schemas(false))
    #     ORDER BY table_name
    # ''')
    # views = cur.fetchall()
    index = 0
    for department in department_names:
        try:
            department_name = str(department)
            # #view_name = re.sub('\d+', '', view_name)#remove numbers from view_name
            # department_name = (department_name.replace(",", "").replace("'", "").replace("(", "").replace(")", ""))
            # #Removes duplicate underscores from "xxx - xxx" formatted string, 
            # # since all spaces and dashes are converted to underscores in previous line
            # department_name = re.sub(r'_+', '_', department_name)
            # debug
            # print(f'name: {department_name}')
            # print(f'id: {department_name.split(" ")[0]}View')
            # print(f'title: {department_names[index]}\n')#access department name at this index
            
            DEPARTMENTS.append({
                'id': f'{department_name.split(" ")[0]}View',
                'title': department_names[index],
                'name': department_names[index],
                'query': f"SELECT id, title, environments, aliases, owners, primary_url, notes, pope_tech, errors, active, cms FROM public.drupal_sites_by_department WHERE department = '{department_names[index]}' ORDER BY id"
            })
            index += 1 #increment index for next department in department_names
        except psycopg2.Error as e:
            print(f"Error: {e}")
    #print(DEPARTMENTS) #debug
    print(f"{index} departments populated successfully")
    return None

def update_pope_tech_from_csv(fname):
    """
    Updates the pope_tech column to True for entries in the master table that
    appear in the CSV file containing sites in Pope Tech.

    Args:
        fname (str): The path to the CSV file. The CSV must contain a 'Primary URL (Site folder name)'
                     column that corresponds to the 'primary_url' column in the
                     drupal_sites_by_department table.
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        with open(fname, 'r') as csvfile:
            reader = csv.DictReader(csvfile)
            urls_to_update = [row['Primary URL (Site folder name)'] for row in reader]

        update_query = """
            UPDATE public.drupal_sites_by_department
            SET pope_tech = TRUE
            WHERE primary_url = %s;
        """
        for url in urls_to_update:
            cur.execute(update_query, (url,))

        conn.commit()

        print(f"Successfully updated pope_tech to True for {len(urls_to_update)} entries.")

    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        print(f"Error updating database: {e}")
    except csv.Error as e:
        print(f"Error parsing CSV: {e}")
    except FileNotFoundError:
        print(f"Error: File not found: {fname}")
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

def populate_contacts(CONTACTS):
    """
    Populate contacts table for each department based on
    wedac_contacts table in schema
    Args:
        CONTACTS (array): Array of dictionaries containing key-value pairs of departments and WEDAC contact info
    """
    conn = get_db_connection()
    # Use DictCursor to get dict results
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute('SELECT * FROM public."wedac_contacts" ORDER BY id')
    contacts = cur.fetchall()

    for contact in contacts:
        # Now contact is a dict, so access by key
        department = contact['department']
        name = contact['name']
        email = contact['email']
        site = contact['site'] if contact['site'] is not None else 'None'
        CONTACTS.append({
            'department': department,
            'name': name,
            'email': email,
            'site': site
        })
    print(f"{len(contacts)} contacts populated successfully")
    cur.close()
    conn.close()
    return None

def is_url_active(url):
    """Check if URL is reachable with proper scheme handling"""
    try:
        # Add scheme if missing
        parsed = urlparse(url)
        if not parsed.scheme:
            url = f"http://{url}"
            
        response = requests.head(url, allow_redirects=True, timeout=10)
        if response.status_code == 200:
            return True
            
        # Fallback to GET for servers that reject HEAD
        response = requests.get(url, allow_redirects=True, timeout=10)
        return response.status_code == 200
    except Exception:
        return False

def mark_inactive_sites():
    """
    Check sites with pope_tech=False and log inactive ones to CSV using
    up to 20 parallel threads for efficiency

    Update 5/2: Write sites with pope_tech=False to a separate CSV using 
    reversed logic
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    # Fetch columns for CSV header
    cur.execute('''
    SELECT * FROM public.drupal_sites_by_department 
    WHERE pope_tech = FALSE 
      AND primary_url IS NOT NULL
      ''')
    rows = cur.fetchall()
    columns = [desc[0] for desc in cur.description]

    # Parallel URL checking
    inactive_rows = []
    active_rows = []
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {executor.submit(is_url_active, row['primary_url']): row for row in rows}
        
        for future in as_completed(futures):
            row = futures[future]
            if not future.result():
                inactive_rows.append(row) #site is inactive
            else:
                active_rows.append(row) #site is active

    # Update database and write CSV
    if inactive_rows:
        with open('inactive_sites.csv', 'w', newline='') as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=columns)
            writer.writeheader()
            
            for row in inactive_rows:
                # Update notes field
                active = row['active'] or ''
                if active == True: #Default is true, must update column to reflect inactive site
                    new_active = False
                    cur.execute('''
                        UPDATE public.drupal_sites_by_department
                        SET active = %s
                        WHERE id = %s
                    ''', (new_active, row['id']))
                
                # Write to CSV
                writer.writerow(dict(row))
                print(f'{row['title']} flagged as inactive')
                
        conn.commit()
    if active_rows:
        with open('active_sites.csv', 'w', newline='') as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=columns)
            writer.writeheader()

            for row in active_rows:
                writer.writerow(dict(row))
                print(f'{row['title']} flagged as active')
    print(f"Checked {len(rows)} URLs, found {len(inactive_rows)} inactive")
    print(f"Checked {len(rows)} URLs, found {len(active_rows)} active")
    cur.close()
    conn.close()

def wedacs_list():
    """Create WEDACS folders with department CSV files"""
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    # Create main WEDACS folder
    main_folder = 'WEDACS'
    os.makedirs(main_folder, exist_ok=True)

    # Get departments with WEDAC contacts
    cur.execute('''
        SELECT DISTINCT department 
        FROM public.wedac_contacts
        WHERE department IS NOT NULL
        ORDER BY department
    ''')
    departments = [row['department'] for row in cur.fetchall()]

    for department in departments:
        # Create department folder
        dept_folder = os.path.join(main_folder, department.strip().replace('/', '_'))
        os.makedirs(dept_folder, exist_ok=True)

        # Write WEDAC contacts
        cur.execute('''
            SELECT *
            FROM public.wedac_contacts
            WHERE department = %s
        ''', (department,))

        wedac_path = os.path.join(dept_folder, 'wedac_contacts.csv')
        with open(wedac_path, 'w', newline='') as f:
            if cur.rowcount > 0:
                writer = csv.DictWriter(f, fieldnames=[desc[0] for desc in cur.description])
                writer.writeheader()
                writer.writerows([dict(row) for row in cur.fetchall()])
        
        # Write pope tech true sites
        cur.execute('''
            SELECT * 
            FROM public.drupal_sites_by_department 
            WHERE department = %s AND pope_tech = TRUE
            ORDER BY title
        ''', (department,))

        pope_rows = cur.fetchall()
        pope_count = len(pope_rows)
        pope_true_path = os.path.join(dept_folder, 'pope_tech_true_sites.csv')
        with open(pope_true_path, 'w', newline='') as f:
            if pope_rows:
                writer = csv.DictWriter(f, fieldnames=[desc[0] for desc in cur.description])
                writer.writeheader()
                writer.writerows([dict(row) for row in pope_rows])
        # Write Pope Tech False active sites
        cur.execute('''
            SELECT * 
            FROM public.drupal_sites_by_department 
            WHERE department = %s AND pope_tech = FALSE
            AND active = true
            ORDER BY title
        ''', (department,))
        
        active_not_pope_rows = cur.fetchall()
        active_not_pope_count = len(active_not_pope_rows)
        active_not_pope_path = os.path.join(dept_folder, 'active_not_in_pope_tech_sites.csv')
        with open(active_not_pope_path, 'w', newline='') as f:
            if active_not_pope_rows:
                writer = csv.DictWriter(f, fieldnames=[desc[0] for desc in cur.description])
                writer.writeheader()
                writer.writerows([dict(row) for row in active_not_pope_rows])
        # Write Pope Tech False inactive sites
        cur.execute('''
            SELECT * 
            FROM public.drupal_sites_by_department 
            WHERE department = %s AND pope_tech = FALSE
            AND active = false
            ORDER BY title
        ''', (department,))
        inactive_not_pope_rows = cur.fetchall()
        inactive_not_pope_count = len(inactive_not_pope_rows)
        inactive_not_pope_path = os.path.join(dept_folder, 'inactive_not_in_pope_tech_sites.csv')
        with open(inactive_not_pope_path, 'w', newline='') as f:
            if inactive_not_pope_rows:
                writer = csv.DictWriter(f, fieldnames=[desc[0] for desc in cur.description])
                writer.writeheader()
                writer.writerows([dict(row) for row in inactive_not_pope_rows])
        
        # Write to site counter file 
        total = pope_count + active_not_pope_count + inactive_not_pope_count
        counter_path = os.path.join(dept_folder, 'site_counter.txt')
        with open(counter_path, 'w') as f:
            f.write(f'{department} Sites\n')
            f.write(f'Total sites: {total}\n')
            f.write(f'Sites in Pope Tech: {pope_count}\n')
            f.write(f'Active sites not in Pope Tech: {active_not_pope_count}\n')
            f.write(f'Inactive sites not in Pope Tech: {inactive_not_pope_count}\n')

        # Write to Google Sites file
        cur.execute('''
            SELECT * 
            FROM public.drupal_sites_by_department 
            WHERE department = %s AND cms = 'Google Sites'
            ORDER BY id
        ''', (department,))
        google_site_rows = cur.fetchall()
        google_site_path = os.path.join(dept_folder, 'google_sites.csv')
        with open(google_site_path, 'w', newline='') as f:
            if google_site_rows:
                writer = csv.DictWriter(f, fieldnames=[desc[0] for desc in cur.description])
                writer.writeheader()
                writer.writerows([dict(row) for row in google_site_rows])
    cur.close()
    conn.close()
    
@app.route('/')
def index():
    """Route to load server data onto page. All data is loaded to allow for efficient client-side
    search and filtering"""
    # Ensure DEPARTMENTS is populated
    if not DEPARTMENTS:
        populate(DEPARTMENTS)

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)  # Use DictCursor for easier template use

    dept_data = {}
    for department in DEPARTMENTS:
        cur.execute(department['query'])
        dept_data[department['title']] = cur.fetchall()

    cur.close()
    conn.close()

    return render_template(
        'index.html',
        tables=DEPARTMENTS,
        table_data=dept_data,
        contacts=CONTACTS
    )

@app.route('/create', methods=['POST']) 
def create(): 
    """Route to add an entry to the database"""
    conn = get_db_connection()
    cur = conn.cursor() 
    
    # Get data from the form
    table_name = request.form['table_name']
    department = request.form.get('department') # Get department from the form
    title = request.form.get('title')
    environments = request.form.get('environments')
    aliases = request.form.get('aliases')
    owners = request.form.get('owners')
    primary_url = request.form.get('primary_url')
    notes = request.form.get('notes')
    pope_tech = request.form.get('pope_tech')
    errors = request.form.get('errors')
    if (errors == '' or 'e' in errors):
            errors = None #Null inputs must be passed as null rather than empty text
    active = request.form.get('active')
    cms = request.form.get('cms')
    # Find the correct table information from the DEPARTMENTS dictionary
    table_info = next((table for table in DEPARTMENTS if table['id'] == table_name), None)

    if table_info:
        #department = table_info['title'] #This is the formatted name
        
        # Get the maximum existing ID from the table
        cur.execute("SELECT MAX(id) FROM public.drupal_sites_by_department")
        max_id = cur.fetchone()[0]
        new_id = max_id + 1 if max_id is not None else 1  # Start at 1 if the table is empty

         #  Define the expected columns explicitly
        columns = ("id, title, environments, aliases, owners, primary_url, department, notes, pope_tech, errors, active, cms")

        #Insert value using SQL into the master table, view will reflect this change; add 2 extra %s for in_popetech and errors 
        create_sql = f'''INSERT INTO public."drupal_sites_by_department" ({columns}) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)'''
        # Build the form values
        
        form_values = [new_id, title, environments, aliases, owners, primary_url, department, notes, pope_tech, errors, active, cms]

        # commit the changes
        cur.execute(create_sql, form_values)
        conn.commit()

    # close the cursor and connection
    cur.close()
    conn.close()
  
    return redirect(url_for('index'))

@app.route('/update', methods=['POST'])
def update():
    """
    Route to update one or more fields of an instance. 

    Constraints:
        Only one row can be updated at a time.
    """  
    conn = get_db_connection()
    cur = conn.cursor()

    try:
        # Get the data from the form
        table_name = request.form['table_name']
        id_value = request.form['id']

        # Find the correct table information from the VIEWS dictionary
        table_info = next((table for table in DEPARTMENTS if table['id'] == table_name), None)

        if not table_info:
            flash(f"{table_name} not found", 'error')
            return redirect(url_for('index'))
        # Helper function to handle null values
        def handle_null_value(value, field_type='text'):
            """Convert empty strings and 'None' to actual NULL values for database"""
            if value is None or value == '' or value == 'None' or value == 'null':
                return None
            
            if field_type == 'integer':
                try:
                    return int(value) if value else None
                except (ValueError, TypeError):
                    return None
            
            return value.strip() if value else None

        # Construct the SET part of the SQL query with proper null handling
        update_fields = []
        values = []
        
        # Define field types for proper handling
        field_types = {
            'title': 'text',
            'environments': 'text',
            'aliases': 'text',
            'owners': 'text',
            'primary_url': 'text',
            'notes': 'text',
            'pope_tech': 'boolean',
            'errors': 'integer',
            'active': 'boolean',
            'cms': 'text'
        }
        
        for key, value in request.form.items():
            if key not in ['table_name', 'id']:  # Exclude table_name and id from update
                field_type = field_types.get(key, 'text')
                processed_value = handle_null_value(value, field_type)
                
                update_fields.append(f'"{key}" = %s')
                values.append(processed_value)

        if update_fields:
            update_fields_str = ', '.join(update_fields)
            query = f'''UPDATE public."drupal_sites_by_department" SET {update_fields_str} WHERE id = %s'''
            values.append(id_value)  # Add ID value to the end
            
            cur.execute(query, values)
            conn.commit()
        else:
            flash("No fields to update", 'warning')

    except psycopg2.Error as e:
        conn.rollback()
        flash(f"Database error: {str(e)}", 'error')
        print(f"Database error in update: {e}")
    finally:
        # Close the cursor and connection 
        cur.close() 
        conn.close() 
  
    return redirect(url_for('index'))
  
@app.route('/delete',methods=['POST'])
def delete():
    """Route to delete an entry from the table """ 
    conn = get_db_connection()
    cur = conn.cursor() 
  
    # Get the data from the form 
    id_value = request.form['id_value']

    delete_sql = f'''DELETE FROM public."drupal_sites_by_department" WHERE id = %s'''
    cur.execute(delete_sql, (id_value,))
    # commit the changes 
    conn.commit() 
  
    # close the cursor and connection 
    cur.close() 
    conn.close() 
  
    return redirect(url_for('index'))

@app.route('/move',methods=['POST'])
def move():
    """Route to move an entry to another department"""
    conn = get_db_connection()
    cur = conn.cursor()

    # Get the data from the form
    id_value = request.form['id_value']
    target_department = request.form['target_department']
    
    # Get the source department before moving
    cur.execute('''SELECT department FROM public."drupal_sites_by_department" WHERE id = %s''', (id_value,))
    result = cur.fetchone()
    
    if not result:
        flash(f"Entry with ID {id_value} not found", 'error')
        return redirect(url_for('index'))
        
    source_department = result[0]  # Get the department value from the result
    
    # Get current date for the note
    from datetime import datetime
    current_date = datetime.now().strftime("%Y-%m-%d")
    
    # Create the note text
    note_text = f"Moved from {source_department} on {current_date}"
    
    # Update both department and notes in a single query
    move_sql = '''
        UPDATE public."drupal_sites_by_department" 
        SET 
            department = %s,
            notes = CASE 
                WHEN notes IS NULL OR notes = 'None' OR notes = '' THEN %s
                ELSE notes || '; ' || %s
            END
        WHERE id = %s
    '''
    
    # Execute the update
    cur.execute(move_sql, (target_department, note_text, note_text, id_value))
    
    # Commit the changes
    conn.commit()
    cur.close()
    conn.close()
    
    return redirect(url_for('index'))

@app.route('/move-all', methods=['POST'])
def move_all():
    """Route to move all entries from one department to another"""
    conn = get_db_connection()
    cur = conn.cursor()

    try:
        # Get the data from the form
        source_department = request.form['source_department']
        target_department = request.form['target_department']
        print(f'Source: {source_department}')
        print(f'Target: {target_department}')
        # Get current date for the note
        from datetime import datetime
        current_date = datetime.now().strftime("%Y-%m-%d")
        
        # Count how many rows will be affected
        count_sql = '''SELECT COUNT(*) FROM public."drupal_sites_by_department" WHERE department = %s'''
        cur.execute(count_sql, (source_department,))
        affected_rows = cur.fetchone()[0]
        print(affected_rows)
        if affected_rows > 0:
            # Update the department field and add a note for all rows in the source department
            move_all_sql = '''
                UPDATE public."drupal_sites_by_department" 
                SET 
                    department = %s,
                    notes = CASE 
                        WHEN notes IS NULL OR notes = 'None' THEN %s
                        ELSE notes || '; ' || %s
                    END
                WHERE department = %s
            '''
            
            # Create the note text
            note_text = f"Moved from {source_department} on {current_date}"
            
            # Execute the update
            cur.execute(move_all_sql, (target_department, note_text, note_text, source_department))
            
            # Commit the changes
            conn.commit()

            message = f"Successfully moved {affected_rows} entries from {source_department} to {target_department}"
        # Close the cursor and connection
        cur.close()
        conn.close()
        
        #Check if this is an AJAX request
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return jsonify({
                'success': True, 
                'message': message
            })
        else:
            # For non-AJAX requests, redirect to index
            flash(message)
            return redirect(url_for('index'))
            
    except Exception as e:
        # Roll back in case of error
        if conn:
            conn.rollback()
        if cur:
            cur.close()
        if conn:
            conn.close()
        
        error_message = f"Error moving data: {str(e)}"
        
        # Check if this is an AJAX request
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return jsonify({
                'success': False, 
                'message': error_message
            }), 500
        else:
            # For non-AJAX requests, redirect to index with error
            flash(error_message, 'error')
            return redirect(url_for('index'))
    
@app.route('/contact/create', methods=['POST'])
def create_contact():
    """Route to add a new contact to the database"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Get data from the form
        department = request.form.get('department')
        name = request.form.get('name')
        email = request.form.get('email')
        site = request.form.get('site')
        
        # Handle empty site field
        if not site or site.strip() == '':
            site = None
            
        # Insert the new contact
        insert_sql = '''
            INSERT INTO public."wedac_contacts" (department, name, email, site) 
            VALUES (%s, %s, %s, %s)
        '''
        cur.execute(insert_sql, (department, name, email, site))
        conn.commit()
        
        flash(f'Contact {name} added successfully to {department}', 'success')
        
    except psycopg2.Error as e:
        conn.rollback()
        flash(f'Error adding contact: {str(e)}', 'error')
        print(f"Database error in create_contact: {e}")
    finally:
        cur.close()
        conn.close()
    
    return redirect(url_for('index'))

@app.route('/contact/update', methods=['POST'])
def update_contact():
    """Route to update an existing contact"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Get data from the form
        contact_id = request.form.get('contact_id')
        department = request.form.get('department')
        name = request.form.get('name')
        email = request.form.get('email')
        site = request.form.get('site')
        
        # Handle empty site field
        if not site or site.strip() == '':
            site = None
            
        # Update the contact
        update_sql = '''
            UPDATE public."wedac_contacts" 
            SET department = %s, name = %s, email = %s, site = %s 
            WHERE id = %s
        '''
        cur.execute(update_sql, (department, name, email, site, contact_id))
        conn.commit()
        
        if cur.rowcount > 0:
            flash(f'Contact {name} updated successfully', 'success')
        else:
            flash('Contact not found', 'error')
            
    except psycopg2.Error as e:
        conn.rollback()
        flash(f'Error updating contact: {str(e)}', 'error')
        print(f"Database error in update_contact: {e}")
    finally:
        cur.close()
        conn.close()
    
    return redirect(url_for('index'))

@app.route('/contact/delete', methods=['POST'])
def delete_contact():
    """Route to delete a contact from the database"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Get contact ID from the form
        contact_id = request.form.get('contact_id')
        
        # Delete the contact
        delete_sql = '''DELETE FROM public."wedac_contacts" WHERE id = %s'''
        cur.execute(delete_sql, (contact_id,))
        conn.commit()
        
        if cur.rowcount > 0:
            flash('Contact deleted successfully', 'success')
        else:
            flash('Contact not found', 'error')
            
    except psycopg2.Error as e:
        conn.rollback()
        flash(f'Error deleting contact: {str(e)}', 'error')
        print(f"Database error in delete_contact: {e}")
    finally:
        cur.close()
        conn.close()
    
    return redirect(url_for('index'))
@app.route('/debug')
def debug():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM public.drupal_sites_by_department LIMIT 5;")
    rows = cur.fetchall()
    return str(rows)

if __name__ == '__main__':
    populate(DEPARTMENTS) #Load in views from the schema before running the app
    populate_contacts(CONTACTS) #Load in WEDAC contacts from the schema before running the app
    #update_pope_tech_from_csv('updated_in_popetech.csv') #leave commented out unless file is updated
    #update_views(VIEWS) #Leave commented out; adds pope_tech and error columns to each view
    #mark_inactive_sites() #Check all URLs in database where pope_tech=False. Uncomment this line to execute
    #wedacs_list() # Populate DAOffice\Database\FlaskApp\WEDACS folder 
    app.run(debug=True) #Debug should be set to False in production
