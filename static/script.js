/*
index.html and the vast majority of its front end functionalities rely on this file.

Javascript was used to avoid writing additional API calls in app.py
for efficiency purposes. Because all data is initially loaded to the 
web page with the index() function in app.py, using this file to execute 
client-side search and filter functionalities instead of server-side search
significantly reduces read operations on the server and improves user experience 
*/

/**
 * Debounce for optimizing functions with frequent calls, ensuring it is
 * only called after a specified delay since the last invocation. Significantly
 * reduces run time for search with a high volume of results by giving
 * the user a little extra time to finish typing before search function is called
 * again. This can be also be used for other functions in the future if needed.
 * @param {Function} func - The function to debounce. Use for search and any other functions when necessary
 * @param {number} wait - The delay in milliseconds.
 * @returns {Function} - The debounced version of the function.
 */
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      func.apply(this, args);
    }, wait);
  }
}

/**
 * Highlight text matches
 * @param {string} text - text in search results
 * @param {string} searchTerm - search input to be highlighted
 */
function highlightMatches(text, searchTerm) {
  if (!searchTerm) return text;
  const regex = new RegExp(`(${escapeRegExp(searchTerm)})`, "gi"); // gi: g = global modifier (applies to all matches); i = case insensitive
  return text.replace(regex, "<mark>$1</mark>");
}

/**
 * Escape regex special characters
 * @param {string} string - string to be highlighted using regex
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // no idea how this works; got it from StackOverflow
}

/**
 * Create boolean badge for color coding true/false entries; makes data a little easier to look at
 * @param {boolean} value - value to be converted to boolean badge
 * @param {boolean} shouldHighlight - specify if value should be highlighted based on search term and highlight button; defualt to false to avoid overlapped styling
 * @param {string} searchTerm - text in search box; default to empty string to avoid overlapped styling 
 */
function createBooleanBadge(value, shouldHighlight = false, searchTerm = "") {
  const badge = document.createElement("span");
  const normalizedValue = value.toString().toLowerCase().trim();
  const isTrue = normalizedValue === "true" || normalizedValue === "yes" || normalizedValue === "1";

  badge.className = `boolean-badge ${isTrue ? "badge-green" : "badge-red"}`;

  let displayText = isTrue ? "Yes" : "No";

  if (shouldHighlight && searchTerm) { // if these are both not null, highlight instead of using a boolean badge
    displayText = highlightMatches(displayText, searchTerm);
    badge.innerHTML = displayText;
  } else {
    badge.textContent = displayText;
  }

  return badge;
}

document.addEventListener("DOMContentLoaded", () => {
  /**
   * Toggles the visibility of a department's data table and its add-entry form.
   * Changes the arrow icon to indicate expanded/collapsed state.
   * @param {HTMLElement} button - The button that was clicked to toggle the table.
   */
  function toggleTable(button) {
    var tableContent = button.nextElementSibling;
    var arrowIcon = button.querySelector(".material-icons:last-child");
    var addEntryForm = tableContent.querySelector(".add-entry-form");

    //Check if department data is expanded or not, treat arrow icon accordingly
    if (tableContent.style.display === "none" || tableContent.style.display === "") {
      tableContent.style.display = "block";
      addEntryForm.style.display = "block";
      arrowIcon.textContent = "arrow_drop_up";
    } else {
      tableContent.style.display = "none";
      addEntryForm.style.display = "none";
      arrowIcon.textContent = "arrow_drop_down";
    }
  }

  // Get all table buttons
  var tableButtons = document.querySelectorAll(".table-button");

  // Loop through all table buttons and set up toggle functionality
  tableButtons.forEach((button) => {
    button.addEventListener("click", function () {
      toggleTable(this);
    });
  });
});

/*
Integrated Search and Filter System
- Search and filters work together to gather relevant results
- Filter options update based on search results
- Search operates on filtered data when filters are active
- Handles all edge cases and maintains state consistency
*/

document.addEventListener("DOMContentLoaded", () => {
  // Global state management
  window.allData = []; // Complete dataset
  window.currentDataset = []; // Current working dataset (after search/filters)
  window.searchTerm = ""; // Current search term
  window.activeFilters = {
    departments: [],
    environments: [],
    popetech: [],
    active: [],
    cms: [],
  } // Current active filters
  window.highlightEnabled = false; 

  // DOM elements
  const searchInput = document.getElementById("search-input");
  const searchResultsDiv = document.getElementById("search-results");
  const highlightButton = document.getElementById("highlight-button");
  const filterButton = document.getElementById("filter-button");
  const filterSort = document.getElementById("filter-sort");
  const resultsCount = document.getElementById("results-count");
  

  initializeData();
  setupEventListeners();

  /**
   * Collect all data from the DOM one time when the page loads
   */
  function initializeData() {
    console.log("Initializing data collection..."); // debug

    document.querySelectorAll(".table-dropdown").forEach((tableDropdown) => {
      const department = tableDropdown.querySelector(".table-button p").textContent.trim();
      const table = tableDropdown.querySelector(".department-table");

      if (table) { // load allData
        table.querySelectorAll("tbody tr").forEach((row) => {
          const cells = Array.from(row.children);
          if (cells.length >= 11) {
            window.allData.push({
              department,
              id: cells[0].textContent.trim(),
              title: cells[1].textContent.trim(),
              environments: cells[2].textContent.trim(),
              aliases: cells[3].textContent.trim(),
              owners: cells[4].textContent.trim(),
              primary_url: cells[5].textContent.trim(),
              notes: cells[6].textContent.trim(),
              pope_tech: cells[7].textContent.trim(),
              errors: cells[8].textContent.trim(),
              active: cells[9].textContent.trim(),
              cms: cells[10].textContent.trim(),
            });
          }
        });
      }
    });

    // Initialize current dataset
    window.currentDataset = [...window.allData];
    console.log(`Loaded ${window.allData.length} records`);
  }

  /**
   * Set up global event listeners (any new event listeners should be set up here to maintain organization and consistency):  
   - search input with debounce optimization
   - toggle highlight button
   - filter button
   - empty search bar check
   */
  function setupEventListeners() {
    // Search input with debouncing
    searchInput.addEventListener("input", debounce(handleSearchInput, 250));

    // Highlight toggle
    highlightButton.addEventListener("click", toggleHighlight);

    // Filter button
    filterButton.addEventListener("click", toggleFilterPanel);

    // Clear search when input is empty
    searchInput.addEventListener("input", () => {
      if (searchInput.value.trim() === "") {
        clearSearch();
      }
    });
  }

  /**
   * Handle search input changes
   */
  function handleSearchInput() {
    const newSearchTerm = searchInput.value.trim().toLowerCase();
    window.searchTerm = newSearchTerm;

    if (newSearchTerm === "") {
      clearSearch();
      return;
    }

    // Apply search to current dataset (which may already be filtered)
    applySearchAndFilters();

    // Update filter options based on search results
    if (isFilterPanelOpen()) {
      updateFilterOptions();
    }
  }

  /**
   * Update results count based on search and filter conditions
   */
  function updateResultsCount(){
    const resultsCount = document.getElementById("results-count");
    const hasFilters = hasActiveFilters();

    if (!hasFilters && window.searchTerm == "") {
      resultsCount.style.display = "none";
    }

    const searchText = window.searchTerm ? ` matching "${window.searchTerm}"` : "";
    resultsCount.textContent = `Showing ${window.currentDataset.length} of ${window.allData.length} results${searchText}`;
    resultsCount.style.display = "block";
  }

  /**
   * Clear search and reset to filtered data (if any filters are active)
   */
  function clearSearch() {
    window.searchTerm = "";

    // If filters are active, show filtered data; otherwise show all data
    if (hasActiveFilters()) {
      applySearchAndFilters(); // This will apply only filters since searchTerm is now cleared
    } else {
      window.currentDataset = [...window.allData]; 
      hideSearchResults(); 
    }

    // Update filter options
    if (isFilterPanelOpen()) {
      updateFilterOptions();
    }
  }

  /**
   * Toggle highlight functionality
   */
  function toggleHighlight() {
    window.highlightEnabled = !window.highlightEnabled;

    if (window.highlightEnabled) {
      highlightButton.classList.add("active");
      highlightButton.setAttribute("aria-pressed", "true");
    } else {
      highlightButton.classList.remove("active");
      highlightButton.setAttribute("aria-pressed", "false");
    }

    // Re-render results with updated highlighting
    if (window.searchTerm || hasActiveFilters()) {
      displayResults();
    }
  }

  /**
   * Toggle filter panel visibility
   */
  function toggleFilterPanel() {
    if (filterSort.style.display === "none" || filterSort.style.display === "") {
      showFilterPanel();
    } else {
      hideFilterPanel();
    }
  }

  /**
   * Show filter panel and initialize filter options
   */
  function showFilterPanel() {
    const availableOptions = getAvailableFilterOptions();

    const filterHTML = `
      <div class="filter-panel">
        <div class="filter-header">
          <h2>Filter and Sort</h2>
          <button id="close-filters" class="close-button">&times;</button>
        </div>
        <p>Select filters below. Filters will be applied to ${window.searchTerm ? "search results" : "all data"}.</p>
        
        <div class="filter-dropdowns">
          ${createFilterDropdown("departments", "Departments", availableOptions.departments)}
          ${createFilterDropdown("environments", "Environments", availableOptions.environments)}
          ${createFilterDropdown("popetech", "Pope Tech", availableOptions.popetech)}
          ${createFilterDropdown("active", "Active", availableOptions.active)}
          ${createFilterDropdown("cms", "CMS", availableOptions.cms)}
        </div>
        
        <div id="active-filters" class="active-filters-section" style="display: none;">
          <div class="filter-chips-header">
            <h3>Active Filters:</h3>
            <button id="clear-all-filters">Clear All</button>
          </div>
          <div id="filter-chips" class="filter-chips"></div>
          <!--<div id="results-count" class="results-count"></div>-->
        </div>
      </div>
    `

    filterSort.innerHTML = filterHTML;
    filterSort.style.display = "block";

    // Set up filter event listeners
    setupFilterEventListeners();

    // Restore previous filter selections
    restoreFilterSelections();

    // Update filter chips display
    updateFilterChips();
  }

  /**
   * Hide filter panel
   */
  function hideFilterPanel() {
    filterSort.style.display = "none";
  }

  /**
   * Check if filter panel is currently open
   */
  function isFilterPanelOpen() {
    return filterSort.style.display === "block";
  }

  /**
   * Get available filter options based on current dataset
   */
  function getAvailableFilterOptions() {
    // Use current dataset (which may be search results or all data if search term is null)
    const dataToAnalyze = window.searchTerm ? window.currentDataset : window.allData;

    // Default options when no data is present
    if (!dataToAnalyze || dataToAnalyze.length === 0) {
      return {
        departments: [],
        environments: [],
        popetech: ["true", "false"],
        active: ["true", "false"],
        cms: [],
      }
    }

    //flatMaps are used to map each filter criteria with corresponding data, then split and trimmed for effective array access
    const departments = [...new Set(dataToAnalyze.map((item) => item.department))].filter(Boolean).sort();
    const environments = [
      ...new Set(
        dataToAnalyze.flatMap((item) =>
          item.environments
            .split(",")
            .map((env) => env.trim())
            .filter(Boolean),
        ),
      ),
    ].sort();
    const popetech = [...new Set(dataToAnalyze.map((item) => item.pope_tech))].filter(Boolean).sort();
    const active = [...new Set(dataToAnalyze.map((item) => item.active))].filter(Boolean).sort();
    const cms = [
      ...new Set(
        dataToAnalyze.flatMap((item) =>
          item.cms
            .split(",")
            .map((cms) => cms.trim())
            .filter(Boolean),
        ),
      ),
    ].sort();

    return { departments, environments, popetech, active, cms }
  }

  /**
   * Create filter dropdown HTML
   */
  function createFilterDropdown(category, label, options) {
    return `
      <div class="filter-dropdown">
        <label>${label} (${options.length})</label>
        <select multiple data-category="${category}" class="filter-select">
          ${options
            .map(
              (option) => `
            <option value="${option}">${formatOptionText(category, option)}</option>
          `,
            )
            .join("")}
        </select>
      </div>
    `
  }

  /**
   * Format option text for display
   */
  function formatOptionText(category, option) {
    if (category === "popetech" || category === "active") {
      return option === "true" ? "Yes" : option === "false" ? "No" : option;
    }
    return option;
  }

  /**
   * Set up filter event listeners: 
   - close button
   - clear button
   - changes to filter selection 
   */
  function setupFilterEventListeners() {
    // Close button
    const closeButton = document.getElementById("close-filters");
    if (closeButton) {
      closeButton.addEventListener("click", hideFilterPanel);
    }

    // Clear all filters
    const clearButton = document.getElementById("clear-all-filters");
    if (clearButton) {
      clearButton.addEventListener("click", clearAllFilters);
    }

    // Filter select changes
    document.querySelectorAll(".filter-select").forEach((select) => {
      select.addEventListener("change", handleFilterChange);
    });
  }

  /**
   * Handle filter selection changes
   */
  function handleFilterChange(event) {
    const category = event.target.dataset.category;
    const selectedOptions = Array.from(event.target.selectedOptions).map((option) => option.value);

    window.activeFilters[category] = selectedOptions;

    // Apply search and filters together
    applySearchAndFilters();

    // Update filter chips display
    updateFilterChips();

    // Update available options in other dropdowns
    updateFilterOptions();
  }

  /**
   * Apply both search and filters to the data
   */
  function applySearchAndFilters() {
    let workingData = [...window.allData];

    // Apply search if there's a search term
    if (window.searchTerm) {
      workingData = workingData.filter((row) =>
        Object.values(row).some((value) => value.toLowerCase().includes(window.searchTerm)),
      );
    }

    // Apply filters to the search results (or all data if no search)
    if (window.activeFilters.departments.length > 0) {
      workingData = workingData.filter((item) => window.activeFilters.departments.includes(item.department));
    }

    if (window.activeFilters.environments.length > 0) {
      workingData = workingData.filter((item) =>
        window.activeFilters.environments.some((env) => item.environments.toLowerCase().includes(env.toLowerCase())),
      );
    }

    if (window.activeFilters.popetech.length > 0) {
      workingData = workingData.filter((item) => window.activeFilters.popetech.includes(item.pope_tech));
    }

    if (window.activeFilters.active.length > 0) {
      workingData = workingData.filter((item) => window.activeFilters.active.includes(item.active));
    }

    if (window.activeFilters.cms.length > 0) {
      workingData = workingData.filter((item) =>
        window.activeFilters.cms.some((cms) => item.cms.toLowerCase().includes(cms.toLowerCase())),
      );
    }

    // Update current dataset
    window.currentDataset = workingData;

    // Display results
    displayResults();

    // Debug
    console.log(
      `Applied search "${window.searchTerm}" and filters. Results: ${workingData.length}/${window.allData.length}`,
    );
  }

  /**
   * Display current results
   */
  function displayResults() {
    const hasSearch = window.searchTerm.length > 0
    const hasFilters = hasActiveFilters()

    if (!hasSearch && !hasFilters) {
      hideSearchResults();
      return;
    }

    const data = window.currentDataset;

    // Clear previous results
    searchResultsDiv.innerHTML = "";

    if (data.length === 0) {
      const noResults = document.createElement("p");
      noResults.textContent =
        hasSearch && hasFilters
          ? "No results matching search and filter criteria"
          : hasSearch
            ? "No results matching search criteria"
            : "No results matching filter criteria";
      searchResultsDiv.appendChild(noResults);
      searchResultsDiv.style.display = "block";
      return;
    }

    updateResultsCount();
    // Create header
    const headerContainer = document.createElement("div");
    headerContainer.style.display = "flex";
    headerContainer.style.justifyContent = "space-between";
    headerContainer.style.alignItems = "center";
    headerContainer.style.backgroundColor = "#7a0019";
    headerContainer.style.padding = "16px";
    headerContainer.style.color = "#fff";

    const header = document.createElement("h2");
    header.style.margin = "0";
    header.style.color = "#fff";

    // Label header based on filter/search criteria
    if (hasSearch && hasFilters) {
      header.textContent = "Search & Filter Results";
    } else if (hasSearch) {
      header.textContent = "Search Results";
    } else {
      header.textContent = "Filter Results";
    }

    // Create export button
    const exportButton = document.createElement("button");
    exportButton.textContent = "Export";
    exportButton.style.backgroundColor = "#fff";
    exportButton.style.color = "#7a0019";
    exportButton.style.border = "none";
    exportButton.style.padding = "8px 16px";
    exportButton.style.borderRadius = "4px";
    exportButton.style.cursor = "pointer";
    exportButton.style.fontWeight = "bold";
    exportButton.addEventListener("click", () => openExportModal(data));

    headerContainer.appendChild(header);
    headerContainer.appendChild(exportButton);
    searchResultsDiv.appendChild(headerContainer);

    // Create table
    const table = document.createElement("table");
    table.className = "search-results-table";

    // Table header
    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th>#</th>
        <th>Department</th>
        <th>Title</th>
        <th>Environments</th>
        <th>Aliases</th>
        <th>Owners</th>
        <th>Primary URL</th>
        <th>Notes</th>
        <th>Pope Tech</th>
        <th>Errors</th>
        <th>Active</th>
        <th>CMS</th>
      </tr>
    `
    table.appendChild(thead);

    // Table body
    const tbody = document.createElement("tbody");
    data.forEach((row, index) => {
      const tr = document.createElement("tr");

      // Helper function to create cells
      const createCell = (content, title) => {
        const td = document.createElement("td");
        td.innerHTML = content;
        td.setAttribute("title", title);
        return td;
      }

      // Row number
      tr.appendChild(createCell(index + 1, index + 1));

      // Department
      const deptContent =
        window.highlightEnabled && hasSearch ? highlightMatches(row.department, window.searchTerm) : row.department;
      tr.appendChild(createCell(deptContent, row.department));

      // Title
      const titleContent =
        window.highlightEnabled && hasSearch ? highlightMatches(row.title, window.searchTerm) : row.title;
      tr.appendChild(createCell(titleContent, row.title));

      // Environments
      const envContent =
        window.highlightEnabled && hasSearch ? highlightMatches(row.environments, window.searchTerm) : row.environments;
      tr.appendChild(createCell(envContent, row.environments));

      // Aliases
      const aliasesContent =
        window.highlightEnabled && hasSearch ? highlightMatches(row.aliases, window.searchTerm) : row.aliases;
      tr.appendChild(createCell(aliasesContent, row.aliases));

      // Owners
      const ownersContent =
        window.highlightEnabled && hasSearch ? highlightMatches(row.owners, window.searchTerm) : row.owners;
      tr.appendChild(createCell(ownersContent, row.owners));

      // Primary URL
      const urlCell = document.createElement("td");
      urlCell.setAttribute("title", row.primary_url);
      const urlLink = document.createElement("a");
      urlLink.href = row.primary_url;
      urlLink.target = "_blank";
      urlLink.innerHTML =
        window.highlightEnabled && hasSearch ? highlightMatches(row.primary_url, window.searchTerm) : row.primary_url;
      urlCell.appendChild(urlLink);
      tr.appendChild(urlCell);

      // Notes
      const notesContent =
        window.highlightEnabled && hasSearch ? highlightMatches(row.notes, window.searchTerm) : row.notes;
      tr.appendChild(createCell(notesContent, row.notes));

      // Pope Tech (boolean badge)
      const popeCell = document.createElement("td");
      popeCell.setAttribute("title", row.pope_tech);
      const popeBadge = createBooleanBadge(row.pope_tech, window.highlightEnabled && hasSearch, window.searchTerm);
      popeCell.appendChild(popeBadge);
      tr.appendChild(popeCell);

      // Errors
      const errorsContent =
        window.highlightEnabled && hasSearch ? highlightMatches(row.errors, window.searchTerm) : row.errors;
      tr.appendChild(createCell(errorsContent, row.errors));

      // Active (boolean badge)
      const activeCell = document.createElement("td");
      activeCell.setAttribute("title", row.active);
      const activeBadge = createBooleanBadge(row.active, window.highlightEnabled && hasSearch, window.searchTerm);
      activeCell.appendChild(activeBadge);
      tr.appendChild(activeCell);

      // CMS
      const cmsContent = window.highlightEnabled && hasSearch ? highlightMatches(row.cms, window.searchTerm) : row.cms;
      tr.appendChild(createCell(cmsContent, row.cms));

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    searchResultsDiv.appendChild(table);

    // Results summary
    const summary = document.createElement("p");
    summary.style.padding = "10px";
    summary.style.fontStyle = "italic";
    summary.textContent = `End of matching results`;
    searchResultsDiv.appendChild(summary);

    searchResultsDiv.style.display = "block";
  }

  /**
   * Hide search results
   */
  function hideSearchResults() {
    searchResultsDiv.style.display = "none";
    searchResultsDiv.innerHTML = "";
    resultsCount.style.display = "none";
  }

  /**
   * Update filter options based on current dataset
   */
  function updateFilterOptions() {
    if (!isFilterPanelOpen()) return;

    const availableOptions = getAvailableFilterOptions();

    // Update each dropdown
    Object.entries(availableOptions).forEach(([category, options]) => {
      const select = document.querySelector(`[data-category="${category}"]`);
      if (select) {
        // Store current selections
        const currentSelections = Array.from(select.selectedOptions).map((opt) => opt.value);

        // Clear and repopulate options
        select.innerHTML = "";
        options.forEach((option) => {
          const optionElement = document.createElement("option");
          optionElement.value = option;
          optionElement.textContent = formatOptionText(category, option);

          // Restore selection if it's still available
          if (currentSelections.includes(option)) {
            optionElement.selected = true;
          }

          select.appendChild(optionElement);
        })

        // Update label with count
        const label = select.parentElement.querySelector("label");
        if (label) {
          const baseLabel = label.textContent.split(" (")[0];
          label.textContent = `${baseLabel} (${options.length})`;
        }
      }
    });
  }

  /**
   * Restore filter selections after rebuilding dropdowns
   */
  function restoreFilterSelections() {
    Object.entries(window.activeFilters).forEach(([category, values]) => {
      const select = document.querySelector(`[data-category="${category}"]`);
      if (select && values.length > 0) {
        Array.from(select.options).forEach((option) => {
          if (values.includes(option.value)) {
            option.selected = true;
          }
        });
      }
    });
  }

  /**
   * Update filter chips display
   */
  function updateFilterChips() {
    const filterChips = document.getElementById("filter-chips");
    const activeFiltersSection = document.getElementById("active-filters");
    const resultsCount = document.getElementById("results-count");

    if (!filterChips || !activeFiltersSection) return;

    const hasFilters = hasActiveFilters();

    if (hasFilters) {
      activeFiltersSection.style.display = "block";

      let chipsHTML = "";

      Object.entries(window.activeFilters).forEach(([category, values]) => {
        values.forEach((value) => {
          const chipColor = getChipColor(category);
          chipsHTML += `
            <div class="filter-chip ${chipColor}" data-category="${category}" data-value="${value}">
              <span class="chip-label">${getCategoryLabel(category)}:</span>
              ${formatOptionText(category, value)}
              <button class="remove-chip" onclick="removeFilter('${category}', '${value}')">&times;</button>
            </div>
          `;
        });
      });

      filterChips.innerHTML = chipsHTML;
      updateResultsCount();
      // Update results count
      // if (resultsCount) {
      //   const searchText = window.searchTerm ? ` matching "${window.searchTerm}"` : "";
      //   resultsCount.textContent = `Showing ${window.currentDataset.length} of ${window.allData.length} results${searchText}`;
      // }
    } else {
      activeFiltersSection.style.display = "none";
    }
  }

  /**
   * Check if any filters are active
   */
  function hasActiveFilters() {
    return Object.values(window.activeFilters).some((arr) => arr.length > 0);
  }

  /**
   * Get chip color for category
   */
  function getChipColor(category) {
    const colors = {
      departments: "chip-red",
      environments: "chip-blue",
      popetech: "chip-green",
      active: "chip-yellow",
      cms: "chip-purple",
    }
    return colors[category] || "chip-gray"
  }

  /**
   * Get category label for filter chips. Any future filter criteria should be added to labels dict
   * @param {string} category - Any of the filter criteria options: dept, env, pope, active, cms
   */
  function getCategoryLabel(category) {
    const labels = {
      departments: "Dept",
      environments: "Env",
      popetech: "Pope",
      active: "Active",
      cms: "CMS",
    }
    return labels[category] || category;
  }

  /**
   * Remove a specific filter
   * @param {string} category - Any of the filter criteria options: department, environment, popetech, active, cms
   * @param {string} value 
   */
  window.removeFilter = (category, value) => {
    window.activeFilters[category] = window.activeFilters[category].filter((item) => item !== value);

    // Update the select element
    const select = document.querySelector(`[data-category="${category}"]`);
    if (select) {
      Array.from(select.options).forEach((option) => {
        if (option.value === value) {
          option.selected = false;
        }
      });
    }

    // Reapply search and filters
    applySearchAndFilters();

    // Update UI
    updateFilterChips();
    updateFilterOptions();
  }

  /**
   * Clear all filters
   */
  function clearAllFilters() {
    window.activeFilters = {
      departments: [],
      environments: [],
      popetech: [],
      active: [],
      cms: [],
    }

    // Clear all select elements
    document.querySelectorAll(".filter-select").forEach((select) => {
      Array.from(select.options).forEach((option) => (option.selected = false));
    });

    // Reapply search (without filters)
    applySearchAndFilters();

    // Update UI
    updateFilterChips();
    updateFilterOptions();
  }

  // Make functions globally available for other parts of the application
  window.integratedSearchFilter = {
    applySearchAndFilters,
    clearAllFilters,
    updateFilterOptions,
    hasActiveFilters,
    getCurrentDataset: () => window.currentDataset,
    getSearchTerm: () => window.searchTerm,
    getActiveFilters: () => window.activeFilters,
  }

  console.log("Integrated search and filter system initialized");
});

/**
 * Open the export modal to allow user to input custom filename
 * @param {array} data - search and or filter results to be exported to csv
 */
function openExportModal(data) {
  // Store the data to be exported
  window.exportData = data;

  // Generate default filename
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const searchText = window.searchTerm ? `_search-${window.searchTerm}` : "";
  const filterText = window.hasActiveFilters() ? "_filtered" : "";
  const defaultFilename = `university-sites${searchText}${filterText}_${timestamp}`;

  // Set default filename in input
  document.getElementById("export-filename").value = defaultFilename;

  // Show the modal
  const modal = document.getElementById("export-modal");
  modal.style.display = "block";

  // Focus on the filename input and select all text
  const filenameInput = document.getElementById("export-filename");
  filenameInput.focus();
  filenameInput.select();
}

/**
 * Close the export modal
 */
function closeExportModal() {
  const modal = document.getElementById("export-modal");
  modal.style.display = "none";
  window.exportData = null;
}

/**
 * Confirm export with custom filename
 */
function confirmExport() {
  const filename = document.getElementById("export-filename").value.trim();

  if (!filename) {
    alert("Please enter a filename");
    return;
  }

  // Remove .csv extension if user added it (we'll add it automatically)
  const cleanFilename = filename.replace(/\.csv$/i, "");

  // Call the export function with custom filename
  exportResults(window.exportData, cleanFilename);

  // Close the modal
  closeExportModal();
}

/**
 * Export current results to CSV with custom filename
 * @param {array} data - search and or filer results to be exported to csv
 * @param {string} customFilename - user inputted filename to html element "export-filename"
 */
function exportResults(data, customFilename = null) {
  if (!data || data.length === 0) {
    alert("No data to export");
    return;
  }

  // Create CSV headers
  const headers = [
    "Department",
    "Title",
    "Environments",
    "Aliases",
    "Owners",
    "Primary URL",
    "Notes",
    "Pope Tech",
    "Errors",
    "Active",
    "CMS",
  ]

  // Create CSV content
  let csvContent = headers.join(",") + "\n"

  data.forEach((row) => {
    const csvRow = [
      `"${row.department}"`,
      `"${row.title}"`,
      `"${row.environments}"`,
      `"${row.aliases}"`,
      `"${row.owners}"`,
      `"${row.primary_url}"`,
      `"${row.notes}"`,
      `"${row.pope_tech}"`,
      `"${row.errors}"`,
      `"${row.active}"`,
      `"${row.cms}"`,
    ]
    csvContent += csvRow.join(",") + "\n"
  });

  // Create and download file
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");

  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);

    // Use custom filename if provided, otherwise generate default
    let filename;
    if (customFilename) {
      filename = `${customFilename}.csv`;
    } else {
      filename = document.getElementById("export-filename");
    }

    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// Add event listeners for the export modal
document.addEventListener("DOMContentLoaded", () => {
  // Close export modal when clicking outside
  window.addEventListener("click", (event) => {
    const exportModal = document.getElementById("export-modal");
    if (event.target === exportModal) {
      closeExportModal();
    }
  })

  // Close export modal when ESC is pressed
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const exportModal = document.getElementById("export-modal");
      if (exportModal && exportModal.style.display === "block") {
        closeExportModal();
      }
    }
  });

  // Handle Enter key in filename input
  const filenameInput = document.getElementById("export-filename");
  if (filenameInput) {
    filenameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        confirmExport();
      }
    });
  }
});

// Declare the hasActiveFilters function
window.hasActiveFilters = () => {
  return Object.values(window.activeFilters).some((arr) => arr.length > 0);
}

//Move functionality
let currentMoveId = null;
/**
 * Open modal to move an entry from one department to another by sending a POST
 * request to the back end. Updates the UI to reflect the move upon success.
 * @param {int} id - The primary key (unique identifier) of the entry to move.
 */
function openMoveModal(id) {
  currentMoveId = id;
  document.getElementById("move-id-value").value = id;

  //get all departments
  const departments = [];
  document.querySelectorAll(".table-button p").forEach((el) => {
    departments.push(el.textContent.trim());
  });

  //populate department list
  populateDepartmentList(departments);

  // Show the modal
  const modal = document.getElementById("move-modal");
  modal.style.display = "block";

  // Focus on the search input
  document.getElementById("department-search").focus();
}

/**
 * Populate available options for selecting a department to move to
 * @param {array} departments 
 */
function populateDepartmentList(departments) {
  const departmentList = document.getElementById("department-list");
  departmentList.innerHTML = "";

  departments.forEach((dept) => {
    const deptItem = document.createElement("div");
    deptItem.className = "department-item";

    const deptName = document.createElement("span");
    deptName.textContent = dept;
    deptItem.appendChild(deptName);

    const moveBtn = document.createElement("button");
    moveBtn.className = "move-confirm-button";
    moveBtn.textContent = "Move";
    moveBtn.onclick = () => {
      document.getElementById("move-target-department").value = dept;
      document.getElementById("move-form").submit();
    }
    deptItem.appendChild(moveBtn);

    departmentList.appendChild(deptItem);
  });
}

/**
 * Open Delete Modal to confirm the user wants to delete an item.
 * Serves as an extra layer of security to prevent accidential deletion
 * @param {int} id - The unique identifier of the entry to delete.
 * @param {string} tableName - Name of the department from which this item is being deleted
 * @param {string} itemTitle - Item to be deleted
 */
function openDeleteModal(id, tableName, itemTitle) {
  // Set the form values
  document.getElementById("delete-id-value").value = id;
  document.getElementById("delete-table-name").value = tableName;

  // Set the confirmation message with the item title
  const message = `Are you sure you want to delete "${itemTitle}"?`
  document.getElementById("delete-confirmation-message").textContent = message;

  // Show the modal
  const modal = document.getElementById("delete-modal");
  modal.style.display = "block";
}

/**
 * Close the delete modal when Cancel button or X is clicked, or when Esc key is pressed
 */
function closeDeleteModal() {
  const modal = document.getElementById("delete-modal");
  modal.style.display = "none";
}

/**
 * Delete entry when the confirm button is clicked
 */
function confirmDelete() {
  document.getElementById("delete-form").submit(); // Submit the delete form
}

document.addEventListener("DOMContentLoaded", () => {
  // Setup for move modal
  const moveModal = document.getElementById("move-modal");
  const moveCloseBtn = moveModal.querySelector(".close-modal");

  moveCloseBtn.onclick = () => {
    moveModal.style.display = "none";
  }

  // Setup for delete modal
  const deleteModal = document.getElementById("delete-modal");
  const deleteCloseBtn = deleteModal.querySelector(".close-modal");

  deleteCloseBtn.onclick = () => {
    deleteModal.style.display = "none";
  }
  // Close modals when clicking outside
  window.onclick = (event) => {
    if (event.target == moveModal) {
      moveModal.style.display = "none";
    }
    if (event.target == deleteModal) {
      deleteModal.style.display = "none";
    }
  }
  // Close modals when ESC is pressed
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const moveModal = document.getElementById("move-modal");
      const deleteModal = document.getElementById("delete-modal");
      const editModal = document.getElementById("edit-modal");

      if (moveModal.style.display === "block") {
        moveModal.style.display = "none";
      }
      if (deleteModal.style.display === "block") {
        deleteModal.style.display = "none";
      }
      if (editModal.style.display === "block") {
        editModal.style.display = "none";
      }
    }
  })

  // Department search functionality
  const departmentSearch = document.getElementById("department-search");
  departmentSearch.addEventListener("input", function () {
    const searchTerm = this.value.toLowerCase();
    const departments = [];

    document.querySelectorAll(".table-button p").forEach((el) => {
      const deptName = el.textContent.trim();
      if (deptName.toLowerCase().includes(searchTerm)) {
        departments.push(deptName);
      }
    });

    populateDepartmentList(departments);
  })
})

// Edit Modal functionality
function openEditModal(id, tableName, title, environments, aliases, owners, primaryUrl, notes, popeTech, errors, active, cms) {
  // Set the form values in the modal
  document.getElementById("edit-id-value").value = id;
  document.getElementById("edit-table-name").value = tableName;
  // Set the values for all input fields
  document.getElementById("edit-title").value = title;
  document.getElementById("edit-environments").value = environments;
  document.getElementById("edit-aliases").value = aliases;
  document.getElementById("edit-owners").value = owners;
  document.getElementById("edit-primary-url").value = primaryUrl;
  document.getElementById("edit-notes").value = notes;
  document.getElementById("edit-pope-tech").value = popeTech;
  document.getElementById("edit-errors").value = errors;
  document.getElementById("edit-active").value = active;
  document.getElementById("edit-cms").value = cms;

  // Set the modal title with the item name
  document.getElementById("edit-modal-title").textContent = `Edit "${title}"`;

  // Show the modal
  const modal = document.getElementById("edit-modal");
  modal.style.display = "block";
}

function closeEditModal() {
  const modal = document.getElementById("edit-modal");
  modal.style.display = "none";
}
/**
 * Close opened modal
 * @param {string} modalID - ID of the modal to be closed
 */
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  modal.setAttribute("aria-hidden", "true");
  modal.style.display = "none";
  document.getElementById("mainContent").setAttribute("aria-hidden", "false");
  if (lastFocusedElement) lastFocusedElement.focus();
}

function openMoveModalFromEdit(id) {
  /**
   * Open Move Modal from within Edit Modal
   * @param {int} id - The unique identifier of the entry to move.
   */

  // Store edit modal state - we'll need to return here
  const editModal = document.getElementById("edit-modal");
  editModal.setAttribute("data-previous-display", "block");
  editModal.style.display = "none";

  // Open the move modal
  openMoveModal(id);

  // Store a flag to return to edit modal when move modal is closed
  document.getElementById("move-modal").setAttribute("data-return-to-edit", "true");
}

/**
 * Open Delete Modal from within Edit Modal
 * @param {int} id - The unique identifier of the entry to move.
 * @param {string} tableName - Name of the department from which this modal is being opened
 * @param {string} itemTitle - Item to be deleted
 */
function openDeleteModalFromEdit(id, tableName, itemTitle) {
  // Store edit modal state - we'll need to return here
  const editModal = document.getElementById("edit-modal");
  editModal.setAttribute("data-previous-display", "block");
  editModal.style.display = "none";

  // Open the delete modal
  openDeleteModal(id, tableName, itemTitle);

  // Store a flag to return to edit modal when delete modal is closed
  document.getElementById("delete-modal").setAttribute("data-return-to-edit", "true");
}

// Extend existing close functions to handle returning to edit modal
document.addEventListener("DOMContentLoaded", () => {
  // Define moveCloseBtn and deleteCloseBtn
  const moveCloseBtn = document.getElementById("move-close-btn");
  const deleteCloseBtn = document.getElementById("delete-close-btn");

  // Original close function for move modal
  const originalMoveClose = moveCloseBtn.onclick;
  moveCloseBtn.onclick = () => {
    const moveModal = document.getElementById("move-modal");
    const shouldReturnToEdit = moveModal.getAttribute("data-return-to-edit") === "true";

    moveModal.style.display = "none";
    moveModal.removeAttribute("data-return-to-edit");

    if (shouldReturnToEdit) {
      document.getElementById("edit-modal").style.display = "block";
    }
  }

  // Original close function for delete modal
  const originalDeleteClose = deleteCloseBtn.onclick;
  deleteCloseBtn.onclick = () => {
    const deleteModal = document.getElementById("delete-modal");
    const shouldReturnToEdit = deleteModal.getAttribute("data-return-to-edit") === "true";

    deleteModal.style.display = "none";
    deleteModal.removeAttribute("data-return-to-edit");

    if (shouldReturnToEdit) {
      document.getElementById("edit-modal").style.display = "block";
    }
  }

  // Close modal when clicking outside
  window.addEventListener("click", (event) => {
    const editModal = document.getElementById("edit-modal");
    const moveModal = document.getElementById("move-modal");
    const deleteModal = document.getElementById("delete-modal");

    if (event.target === editModal) {
      editModal.style.display = "none";
    } else if (event.target === moveModal) {
      moveModal.style.display = "none";

      if (moveModal.getAttribute("data-return-to-edit") === "true") {
        moveModal.removeAttribute("data-return-to-edit");
        editModal.style.display = "block";
      }
    } else if (event.target === deleteModal) {
      deleteModal.style.display = "none";

      if (deleteModal.getAttribute("data-return-to-edit") === "true") {
        deleteModal.removeAttribute("data-return-to-edit");
        editModal.style.display = "block";
      }
    }
  });
});

/**
 * Open modal to move all entries from one department to another
 * @param {string} sourceDepartment - The department from which to move all entries
 */
function openMoveAllModal(sourceDepartment) {
  // Store the source department
  document.getElementById("move-all-source-department").value = sourceDepartment;
  
  // Update the modal title
  const modalTitle = document.querySelector("#move-all-modal .modal-content h2");
  if (modalTitle) {
    modalTitle.textContent = `Move All Data from ${sourceDepartment}`;
  }
  
  // Get all departments except the source department
  const departments = [];
  document.querySelectorAll(".table-button p").forEach((el) => {
    const deptName = el.textContent.trim();
    if (deptName !== sourceDepartment) {
      departments.push(deptName);
    }
  });

  // Populate department list
  populateMoveAllDepartmentList(departments);

  // Show the modal
  const modal = document.getElementById("move-all-modal");
  modal.style.display = "block";

  // Focus on the search input
  document.getElementById("move-all-department-search").focus();
}

/**
 * Close the move all modal
 */
function closeMoveAllModal() {
  const modal = document.getElementById("move-all-modal");
  modal.style.display = "none";
}

/**
 * Populate the department list for the move-all modal
 * @param {array} departments - Array of department names
 */
function populateMoveAllDepartmentList(departments) {
  const departmentList = document.getElementById("move-all-department-list");
  departmentList.innerHTML = "";

  departments.forEach((dept) => {
    const deptItem = document.createElement("div");
    deptItem.className = "department-item";

    const deptName = document.createElement("span");
    deptName.textContent = dept;
    deptItem.appendChild(deptName);

    const moveBtn = document.createElement("button");
    moveBtn.className = "move-confirm-button";
    moveBtn.textContent = "Move";
    moveBtn.onclick = () => {
      // Get the source department
      const sourceDept = document.getElementById("move-all-source-department").value;
      
      // Confirm before moving
      if (confirm(`Are you sure you want to move all data from "${sourceDept}" to "${dept}"?`)) {
        moveAllData(sourceDept, dept);
      }
    };
    deptItem.appendChild(moveBtn);

    departmentList.appendChild(deptItem);
  });
}

/**
 * Move all data from one department to another via AJAX
 * @param {string} sourceDepartment - Source department name
 * @param {string} targetDepartment - Target department name
 */
function moveAllData(sourceDepartment, targetDepartment) {
  // Show loading indicator
  const moveAllModal = document.getElementById("move-all-modal");
  const departmentList = document.getElementById("move-all-department-list");
  departmentList.innerHTML = "<div class='loading'>Moving data...</div>";
  
  // Create form data
  const formData = new FormData();
  formData.append("source_department", sourceDepartment);
  formData.append("target_department", targetDepartment);
  
  // Send AJAX request
  fetch("/move-all", {
    method: "POST",
    body: formData,
    headers: {
      'X-Requested-With': 'XMLHttpRequest'
    }
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return response.json();
  })
  .then(data => {
    // Close the modal
    moveAllModal.style.display = "none";
    
    // Remove the old source department from the dropdown
    const departmentDropdown = document.getElementById("department-dropdown");
    if (departmentDropdown) {
      // Find and remove the option with value == sourceDepartment
      for (let i = 0; i < departmentDropdown.options.length; i++) {
        if (departmentDropdown.options[i].value === sourceDepartment) {
          departmentDropdown.remove(i);
          break;
        }
      }
    }
    
    // Show success message
    alert(data.message);

    // Optionally reload the page if you want to refresh all data
    // window.location.reload();
  });
}

// Add event listener for the move-all department search
document.addEventListener("DOMContentLoaded", () => {
  const moveAllDepartmentSearch = document.getElementById("move-all-department-search");
  if (moveAllDepartmentSearch) {
    moveAllDepartmentSearch.addEventListener("input", function() {
      const searchTerm = this.value.toLowerCase();
      const departments = [];
      const sourceDept = document.getElementById("move-all-source-department").value;

      document.querySelectorAll(".table-button p").forEach((el) => {
        const deptName = el.textContent.trim();
        if (deptName.toLowerCase().includes(searchTerm) && deptName !== sourceDept) {
          departments.push(deptName);
        }
      });

      populateMoveAllDepartmentList(departments);
    });
  }
  
  // Close move-all modal when clicking outside
  window.addEventListener("click", (event) => {
    const moveAllModal = document.getElementById("move-all-modal");
    if (event.target === moveAllModal) {
      moveAllModal.style.display = "none";
    }
  });
  
  // Close move-all modal when ESC is pressed
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const moveAllModal = document.getElementById("move-all-modal");
      if (moveAllModal && moveAllModal.style.display === "block") {
        moveAllModal.style.display = "none";
      }
    }
  });
});

// Contact Management Functions

/**
 * Open modal to add a new contact
 * @param {string} department - The department to add the contact to
 */
function openAddContactModal(department) {
  // Reset form
  document.getElementById("contact-form").reset()
  document.getElementById("contact-id").value = ""
  document.getElementById("contact-department").value = department

  // Set modal title and form action
  document.getElementById("contact-modal-title").textContent = `Add Contact to ${department}`
  document.getElementById("contact-form").action = "/contact/create"
  document.getElementById("contact-submit-button").textContent = "Add Contact"

  // Show modal
  document.getElementById("contact-modal").style.display = "block"

  // Focus on name field
  document.getElementById("contact-name").focus()
}

/**
 * Open modal to edit an existing contact
 * @param {int} contactId - The ID of the contact to edit
 * @param {string} department - The department the contact belongs to
 * @param {string} name - Current contact name
 * @param {string} email - Current contact email
 * @param {string} site - Current contact site
 */
function openEditContactModal(contactId, department, name, email, site) {
  // Set form values
  document.getElementById("contact-id").value = contactId
  document.getElementById("contact-department").value = department
  document.getElementById("contact-name").value = name
  document.getElementById("contact-email").value = email
  document.getElementById("contact-site").value = site || ""

  // Set modal title and form action
  document.getElementById("contact-modal-title").textContent = `Edit Contact: ${name}`
  document.getElementById("contact-form").action = "/contact/update"
  document.getElementById("contact-submit-button").textContent = "Update Contact"

  // Show modal
  document.getElementById("contact-modal").style.display = "block"

  // Focus on name field
  document.getElementById("contact-name").focus()
}

/**
 * Close the contact modal
 */
function closeContactModal() {
  document.getElementById("contact-modal").style.display = "none"
}

/**
 * Open confirmation modal to delete a contact
 * @param {int} contactId - The ID of the contact to delete
 * @param {string} contactName - The name of the contact for confirmation
 */
function openContactDeleteModal(contactId, contactName) {
  // Set form values
  document.getElementById("contact-delete-id").value = contactId

  // Set confirmation message
  document.getElementById("contact-delete-confirmation-message").textContent =
    `Are you sure you want to delete the contact "${contactName}"?`

  // Show modal
  document.getElementById("contact-delete-modal").style.display = "block"
}

/**
 * Close the contact delete modal
 */
function closeContactDeleteModal() {
  document.getElementById("contact-delete-modal").style.display = "none"
}

/**
 * Confirm and execute contact deletion
 */
function confirmContactDelete() {
  document.getElementById("contact-delete-form").submit()
}

// Add event listeners for contact modals
document.addEventListener("DOMContentLoaded", () => {
  // Contact modal event listeners
  const contactModal = document.getElementById("contact-modal")
  const contactDeleteModal = document.getElementById("contact-delete-modal")

  // Close modals when clicking outside
  window.addEventListener("click", (event) => {
    if (event.target === contactModal) {
      closeContactModal()
    }
    if (event.target === contactDeleteModal) {
      closeContactDeleteModal()
    }
  })

  // Close modals when ESC is pressed
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (contactModal.style.display === "block") {
        closeContactModal()
      }
      if (contactDeleteModal.style.display === "block") {
        closeContactDeleteModal()
      }
    }
  })

  // Handle Enter key in contact form
  const contactForm = document.getElementById("contact-form")
  contactForm.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") {
      e.preventDefault()
      contactForm.submit()
    }
  })
})

