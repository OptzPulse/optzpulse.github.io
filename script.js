// Register DataLabels plugin globally
Chart.register(ChartDataLabels);

// State
let allClientsData = [];
let allRawData = []; // Store raw Supabase data
let currentMonth = 11; // Dezembro (0-11)
let currentYear = 2025;
let activeChart = null;
let consolidatedChart = null;
let selectedClients = new Set();
let currentSort = 'usage'; // 'alpha-asc', 'alpha-desc', 'usage'
let visibleColumns = new Set(['group-scale', 'group-trip', 'group-usage', 'group-crew', 'group-veh']);
let chartSelectedCompanies = new Set();

// Helper Functions
function getMonthName(monthIndex) {
    const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    return months[monthIndex];
}

// Get last 3 months from current month
function getLast3Months() {
    const months = [];
    for (let i = 2; i >= 0; i--) {
        let month = currentMonth - i;
        let year = currentYear;

        if (month < 0) {
            month += 12;
            year--;
        }

        months.push({ month: month + 1, year, display: getMonthName(month) }); // month + 1 for DB (1-12)
    }
    return months;
}

// Populate Filters from Data
function populateFilters(data) {
    if (!data || data.length === 0) return;

    // Extract unique year/months
    const uniqueDates = [];
    const seen = new Set();
    const yearsSet = new Set();
    const yearMonthMap = {}; // year -> Set of months

    // Sort descending
    const sortedData = [...data].sort((a, b) => {
        if (a.ano !== b.ano) return b.ano - a.ano;
        return b.mes - a.mes;
    });

    sortedData.forEach(r => {
        const key = `${r.ano}-${r.mes}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueDates.push({ year: r.ano, month: r.mes, display: `${getMonthName(r.mes - 1)} ${r.ano}` });
        }

        yearsSet.add(r.ano);
        if (!yearMonthMap[r.ano]) yearMonthMap[r.ano] = new Set();
        yearMonthMap[r.ano].add(r.mes);
    });

    // 1. Populate Modal Filter
    const modalSelect = document.getElementById('modalMonthFilter');
    if (modalSelect) {
        modalSelect.innerHTML = '';
        uniqueDates.forEach(d => {
            const opt = document.createElement('option');
            opt.value = `${d.year}-${d.month}`;
            opt.textContent = d.display;
            if (d.year === currentYear && d.month === (currentMonth + 1)) {
                opt.selected = true;
            }
            modalSelect.appendChild(opt);
        });
    }

    // 2. Populate Global Year Filter
    const yearSelect = document.getElementById('globalYearFilter');
    const monthSelect = document.getElementById('globalMonthFilter');

    if (yearSelect && monthSelect) {
        yearSelect.innerHTML = '';
        const sortedYears = [...yearsSet].sort((a, b) => b - a);

        sortedYears.forEach(y => {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            if (y === currentYear) opt.selected = true;
            yearSelect.appendChild(opt);
        });

        // Function exposed to update months when year changes
        window.updateGlobalMonths = () => {
            const selectedY = parseInt(yearSelect.value);
            const validMonths = yearMonthMap[selectedY] || new Set();

            monthSelect.innerHTML = '';
            const sortedMonths = [...validMonths].sort((a, b) => a - b);

            sortedMonths.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m - 1;
                opt.textContent = getMonthName(m - 1);
                if ((m - 1) === currentMonth) opt.selected = true;
                monthSelect.appendChild(opt);
            });

            // Auto-select last month if current is invalid
            if (!validMonths.has(currentMonth + 1) && sortedMonths.length > 0) {
                const lastM = sortedMonths[sortedMonths.length - 1];
                monthSelect.value = lastM - 1;
                currentMonth = lastM - 1;

                // Trigger data update since we changed the month
                if (typeof window.transformDataForDashboard === 'function') {
                    allClientsData = window.transformDataForDashboard(allRawData, currentYear, currentMonth);
                    updateMonthHeaders();
                    renderTable();
                }
            }
        };

        // Initial update
        window.updateGlobalMonths();
    }
}

// Update month headers in table
function updateMonthHeaders() {
    if (allClientsData.length === 0) return;
    const periods = allClientsData[0].displayPeriods;
    const n = periods.length;

    // 1. Update Colspans and visibility of Group Headers
    const groupClasses = ['group-scale', 'group-trip', 'group-usage', 'group-crew', 'group-veh'];
    groupClasses.forEach(cls => {
        const header = document.querySelector(`.${cls}`);
        if (header) {
            header.colSpan = n;
            header.style.display = visibleColumns.has(cls) ? '' : 'none';
        }
    });

    // 2. Clear and rebuild Sub-Headers (only for visible groups)
    const subRow = document.querySelector('.sub-headers');
    if (subRow) {
        let html = '';
        const buildGroup = (groupClass) => {
            if (!visibleColumns.has(groupClass)) return;
            periods.forEach((p, i) => {
                const isLast = (i === n - 1);
                const dividerCls = isLast ? 'group-divider' : '';
                const monthCls = `col-month-${i}`;
                html += `<th class="${dividerCls} ${monthCls}">${p.display}</th>`;
            });
        };

        buildGroup('group-scale');
        buildGroup('group-trip');
        buildGroup('group-usage');
        buildGroup('group-crew');
        buildGroup('group-veh');

        subRow.innerHTML = html;
    }
}

// Calculate trend between current and previous
function calculateTrend(current, previous) {
    if (previous === 0) return { percent: 0, arrow: '→', colorClass: 'color-neutral' };

    const diff = current - previous;
    const rawPercent = (diff / previous) * 100;
    const percent = Math.round(rawPercent);

    let arrow = '→';
    let colorClass = 'color-neutral';

    const HIGH_GROWTH_THRESHOLD = 25;

    if (percent === 0) {
        arrow = '→';
        colorClass = 'color-neutral';
    } else if (percent > 0) {
        arrow = '↑';
        colorClass = percent > HIGH_GROWTH_THRESHOLD ? 'color-blue' : 'color-green';
    } else if (percent < 0) {
        arrow = '↓';
        colorClass = 'color-red';
    }

    return { percent, arrow, colorClass };
}

// Render metric cell
function createMetricCell(current, previous, monthIndex, isLast = false) {
    const trend = calculateTrend(current, previous);
    const sign = trend.percent > 0 ? '+' : '';
    const percentStr = `${sign}${trend.percent}%`;
    const dividerClass = isLast ? 'group-divider' : '';
    const monthClass = `col-month-${monthIndex}`;

    return `
        <td class="metric-cell ${dividerClass} ${monthClass}">
            <div class="metric-content">
                <span class="metric-value">${current}</span>
                <div class="trend-indicator ${trend.colorClass}">
                    <span class="trend-arrow">${trend.arrow}</span>
                    <span class="trend-percent">${percentStr}</span>
                </div>
            </div>
        </td>
    `;
}

// Render Health Score cell
function createHealthScoreCell(score, prevScore, monthIndex, isLast = false) {
    const dividerClass = isLast ? 'group-divider' : '';
    const monthClass = `col-month-${monthIndex}`;

    // Handle 'Not Started' / Implantation state
    if (score === null) {
        return `
            <td class="metric-cell usage-cell ${dividerClass} ${monthClass}">
                <div class="usage-container">
                    <div class="usage-top-info">
                        <span class="status-label implantacao">IMPLANTAÇÃO</span>
                    </div>
                    <div class="usage-bar-bg">
                        <div class="usage-bar-fill implantacao" style="width: 0%"></div>
                    </div>
                </div>
            </td>
        `;
    }

    // Trend calculation
    const trend = calculateTrend(score, prevScore || 0);
    const sign = trend.percent > 0 ? '+' : '';
    const percentStr = `${sign}${trend.percent}%`;

    // Define status and bar color based on thresholds
    let statusLabel = 'INATIVO';
    let statusClass = 'inativo';

    if (score > 70) {
        statusLabel = 'SAUDÁVEL';
        statusClass = 'saudavel';
    } else if (score > 40) {
        statusLabel = 'OPERACIONAL';
        statusClass = 'operacional';
    } else if (score > 20) {
        statusLabel = 'BAIXO';
        statusClass = 'baixo';
    }

    return `
        <td class="metric-cell usage-cell ${dividerClass} ${monthClass}">
            <div class="usage-container">
                <div class="usage-top-info">
                    <span class="status-label ${statusClass}">${statusLabel}</span>
                    <div class="trend-indicator ${trend.colorClass}">
                        <span class="trend-arrow" style="font-size: 10px">${trend.arrow}</span>
                        <span class="trend-percent" style="font-size: 10px">${percentStr}</span>
                    </div>
                </div>
                <div class="usage-bar-bg">
                    <div class="usage-bar-fill ${statusClass}" style="width: ${score}%"></div>
                </div>
            </div>
        </td>
    `;
}

// Get data for a specific company and month
function getCompanyMonthData(companyRecords, year, month) {
    const record = companyRecords.find(r => r.ano === year && r.mes === month);
    return record || {
        total_servicos: 0,
        total_veiculos: 0,
        total_tripulantes: 0,
        total_alteracoes_escala: 0
    };
}

// Local transformDataForDashboard removed. Using window.transformDataForDashboard from api.js

// Generate fake data for testing (remove when Supabase is configured)
function generateFakeData() {
    const companies = ["viop", "PÁSSARO VERDE", "UNESUL", "PLANALTO"];
    const fakeData = [];

    // Generate data for last 6 months for each company
    for (let i = 5; i >= 0; i--) {
        let month = currentMonth - i + 1; // +1 for DB format (1-12)
        let year = currentYear;

        if (month < 1) {
            month += 12;
            year--;
        }

        companies.forEach((companyName, idx) => {
            fakeData.push({
                nome_empresa: companyName,
                codigo_empresa: String(idx + 1),
                ano: year,
                mes: month,
                total_servicos: Math.floor(Math.random() * 500) + 100,
                total_veiculos: Math.floor(Math.random() * 50) + 10,
                total_tripulantes: Math.floor(Math.random() * 100) + 20,
                total_alteracoes_escala: Math.floor(Math.random() * 50) + 5
            });
        });
    }

    return fakeData;
}

// Load and render data
async function loadAndRenderData() {
    try {
        const tbody = document.getElementById('tableBody');
        tbody.innerHTML = '<tr><td colspan="15" style="text-align: center; padding: 40px;">Carregando dados...</td></tr>';

        console.log('🚀 Dashboard: Iniciando loadAndRenderData');

        // Try to fetch from Supabase, fallback to fake data
        try {
            if (typeof window.fetchAllMetrics === 'function') {
                console.log('🛰️ Dashboard: Chamando API do Supabase...');
                allRawData = await window.fetchAllMetrics();
                console.log('📊 Dashboard: Dados recebidos da API:', allRawData ? allRawData.length : 0);
            } else {
                console.warn('⚠️ Dashboard: window.fetchAllMetrics não encontrada!');
            }
        } catch (error) {
            console.error('❌ Dashboard: Erro ao buscar dados reais:', error);
        }

        // Use fake data if no real data
        if (!allRawData || allRawData.length === 0) {
            console.log('💡 Dashboard: Nenhum dado real. Usando dados FAKE para demonstração.');
            allRawData = generateFakeData();
        } else {
            console.log('🎉 Dashboard: Usando dados REAIS do banco!');
        }

        // Transform and render
        if (typeof window.transformDataForDashboard === 'function') {
            allClientsData = window.transformDataForDashboard(allRawData, currentYear, currentMonth);
        } else {
            console.error('❌ Dashboard: window.transformDataForDashboard não encontrada!');
            // Fallback to local if still exists or empty
            allClientsData = [];
        }

        populateFilters(allRawData);
        updateMonthHeaders();
        renderTable();

    } catch (error) {
        console.error('💥 Dashboard Error:', error);
        const tbody = document.getElementById('tableBody');
        tbody.innerHTML = '<tr><td colspan="15" style="text-align: center; padding: 40px; color: var(--color-danger);">Erro ao carregar dados. Verifique o console.</td></tr>';
    }
}

function renderTable() {
    try {
        const tbody = document.getElementById('tableBody');
        tbody.innerHTML = '';

        if (!allClientsData || allClientsData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="15" style="text-align: center; padding: 40px;">Nenhum dado disponível</td></tr>';
            calculateConsolidatedData();
            return;
        }

        // Apply sorting and filtering before rendering
        const sortedData = applySorting([...allClientsData]);

        sortedData.forEach((client, index) => {

            const tr = document.createElement('tr');
            const initials = client.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

            let rowHtml = `<td class="col-client"><div class="client-avatar">${initials}</div>${client.name}</td>`;

            const metrics = client.metrics || [];
            const n = metrics.length;

            // Group Scale
            if (visibleColumns.has('group-scale')) {
                metrics.forEach((m, i) => rowHtml += createMetricCell(m.scale[1], m.scale[0], i, i === n - 1));
            }
            // Group Trips
            if (visibleColumns.has('group-trip')) {
                metrics.forEach((m, i) => rowHtml += createMetricCell(m.trips[1], m.trips[0], i, i === n - 1));
            }
            // Group Usage
            if (visibleColumns.has('group-usage')) {
                metrics.forEach((m, i) => rowHtml += createHealthScoreCell(m.usage[1], m.usage[0], i, i === n - 1));
            }
            // Group Crew
            if (visibleColumns.has('group-crew')) {
                metrics.forEach((m, i) => rowHtml += createMetricCell(m.crew[1], m.crew[0], i, i === n - 1));
            }
            // Group Vehicles
            if (visibleColumns.has('group-veh')) {
                metrics.forEach((m, i) => rowHtml += createMetricCell(m.vehicles[1], m.vehicles[0], i, i === n - 1));
            }

            tr.innerHTML = rowHtml;
            tr.addEventListener('click', () => openClientModal(client, index));
            tbody.appendChild(tr);
        });

        calculateConsolidatedData();
    } catch (e) {
        console.error("Error in renderTable:", e);
        throw e; // Bubble up to main loader
    }
}

// Consolidated Data
function calculateConsolidatedData() {
    try {
        let totalDrivers = 0;
        let totalVehicles = 0;
        let totalTrips = 0;
        let prevTrips = 0;

        // Sum for the most recent month available (if any)
        // Only include selected clients
        if (allClientsData && allClientsData.length > 0) {
            allClientsData.forEach(c => {
                // Apply client filter
                if (selectedClients.size > 0 && !selectedClients.has(c.name)) {
                    return;
                }

                const m = c.metrics || [];
                if (m.length > 0) {
                    const latest = m[m.length - 1];
                    totalDrivers += latest.crew[1] || 0;
                    totalVehicles += latest.vehicles[1] || 0;
                    totalTrips += latest.trips[1] || 0;
                    prevTrips += latest.trips[0] || 0;
                }
            });
        }

        // Update KPIs (These will be 0 if allClientsData is empty)
        document.getElementById('kpiDrivers').textContent = totalDrivers.toLocaleString();
        document.getElementById('kpiVehicles').textContent = totalVehicles.toLocaleString();
        document.getElementById('kpiTrips').textContent = totalTrips.toLocaleString();

        const vehPerTrip = totalVehicles > 0 ? Math.round(totalTrips / totalVehicles) : 0;
        const crewPerTrip = totalDrivers > 0 ? Math.round(totalTrips / totalDrivers) : 0;
        document.getElementById('kpiVehPerTrip').textContent = vehPerTrip;
        document.getElementById('kpiCrewPerTrip').textContent = crewPerTrip;

        const tripsTrend = calculateTrend(totalTrips, prevTrips);
        const sign = tripsTrend.percent > 0 ? '+' : '';
        const trendEl = document.getElementById('kpiTripsTrend');
        if (trendEl) {
            if (totalTrips === 0 && prevTrips === 0) {
                trendEl.textContent = '--';
                trendEl.className = 'card-trend';
            } else {
                trendEl.textContent = `${sign}${tripsTrend.percent}% vs Mês Anterior`;
                trendEl.className = `card-trend ${tripsTrend.colorClass}`;
            }
        }

        const activeBtn = document.querySelector('.chart-toggle-btn.active');
        const activeMode = activeBtn ? activeBtn.dataset.mode : 'consolidated';
        renderConsolidatedChart(activeMode);
        renderDistributionChart();
    } catch (e) {
        console.error("Error in calculateConsolidatedData:", e);
    }
}

// Variables declared at top of file, removing duplicates here
let distributionChart = null;

function renderDistributionChart() {
    try {
        const ctx = document.getElementById('distributionChart').getContext('2d');
        if (distributionChart) distributionChart.destroy();

        // Target Month (database format 1-12)
        const targetMonthDB = currentMonth + 1;

        // Extract data for EXACTLY the selected month and year
        // Filter by selected clients
        const data = allRawData.filter(r => {
            if (r.ano !== currentYear || r.mes !== targetMonthDB) return false;
            // Apply client filter
            if (selectedClients.size > 0 && !selectedClients.has(r.nome_empresa)) return false;
            return true;
        })
            .map(r => ({
                name: r.nome_empresa,
                value: r.total_servicos || 0
            }))
            .filter(d => d.value > 0);

        if (data.length === 0) {
            // No data for this month, chart remains empty (destroyed above)
            return;
        }

        // Sort descending
        data.sort((a, b) => b.value - a.value);

        let finalLabels = [];
        let finalValues = [];
        const colors = ['#00B67A', '#009e6a', '#34d399', '#6ee7b7', '#a7f3d0', '#9ca3af'];

        if (data.length > 5) {
            const top4 = data.slice(0, 4);
            const others = data.slice(4);
            const othersSum = others.reduce((acc, curr) => acc + curr.value, 0);

            finalLabels = [...top4.map(d => d.name), 'Outros'];
            finalValues = [...top4.map(d => d.value), othersSum];
        } else {
            finalLabels = data.map(d => d.name);
            finalValues = data.map(d => d.value);
        }

        distributionChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: finalLabels,
                datasets: [{
                    data: finalValues,
                    backgroundColor: colors,
                    borderWidth: 2,
                    borderColor: '#ffffff',
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'circle',
                            boxWidth: 8,
                            font: { family: "'Inter', sans-serif", size: 10 },
                            color: '#6b7280',
                            padding: 10
                        }
                    },
                    datalabels: {
                        color: '#fff',
                        font: {
                            family: "'Inter', sans-serif",
                            weight: 'bold',
                            size: 9
                        },
                        formatter: (value, context) => {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((value / total) * 100).toFixed(1) + '%';
                            return pct;
                        },
                        display: (context) => {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            return (context.dataset.data[context.dataIndex] / total) > 0.05; // Only show if > 5% to avoid overlap
                        },
                        textShadowColor: 'rgba(0,0,0,0.3)',
                        textShadowBlur: 4
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const val = context.parsed;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = ((val / total) * 100).toFixed(1) + '%';
                                return ` ${context.label}: ${val} (${pct})`;
                            }
                        },
                        backgroundColor: '#1a1a1a',
                        titleFont: { family: "'Inter', sans-serif" },
                        bodyFont: { family: "'Inter', sans-serif" },
                        cornerRadius: 4,
                        padding: 8
                    }
                },
                layout: { padding: 0 }
            }
        });
    } catch (e) {
        console.error("Error rendering distribution chart:", e);
    }
}

function renderConsolidatedChart(mode = 'consolidated') {
    const ctx = document.getElementById('consolidatedChart').getContext('2d');
    if (consolidatedChart) consolidatedChart.destroy();

    const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

    // Determine available months from data
    const availableMonths = new Set();
    allRawData.forEach(r => {
        if (r.ano === currentYear) availableMonths.add(r.mes);
    });

    let labels = [];
    let monthsToShow = [];

    // Logic: Show all available months for the selected year
    if (availableMonths.size === 0) {
        labels = monthNames.slice(0, 3);
        monthsToShow = [1, 2, 3];
    } else {
        const sortedMonths = [...availableMonths].sort((a, b) => a - b);
        sortedMonths.forEach(m => {
            monthsToShow.push(m);
            labels.push(monthNames[m - 1]);
        });
    }

    if (mode === 'consolidated') {
        // Get distinct companies, filtered by selection
        let distinctCompanies = [...new Set(allRawData.map(r => r.nome_empresa))];
        if (selectedClients.size > 0) {
            distinctCompanies = distinctCompanies.filter(c => selectedClients.has(c));
        }

        const dataPoints = monthsToShow.map(mNum => {
            if (!availableMonths.has(mNum)) return null;

            // Health of the portfolio is the AVERAGE of the health of its clients
            let sumScores = 0;
            let companyCount = 0;

            distinctCompanies.forEach(comp => {
                const companyHistory = allRawData.filter(r => r.nome_empresa === comp);

                // calculateHealthScore returns null if the company hasn't 'started' yet
                // based on the first month they have operational data.
                const score = window.calculateHealthScore(companyHistory, currentYear, mNum);

                if (score !== null) {
                    sumScores += score;
                    companyCount++;
                }
            });

            return companyCount > 0 ? Math.round(sumScores / companyCount) : 0;
        });

        const gradient = ctx.createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, 'rgba(0, 182, 122, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 182, 122, 0.0)');

        datasets = [{
            label: 'Geral',
            data: dataPoints,
            borderColor: '#00B67A',
            backgroundColor: gradient,
            borderWidth: 3,
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            spanGaps: true,
            clip: false
        }];

    } else {
        // Company Breakdown - filter by selected clients
        let distinctCompanies = [...new Set(allRawData.map(r => r.nome_empresa))];
        if (selectedClients.size > 0) {
            distinctCompanies = distinctCompanies.filter(c => selectedClients.has(c));
        }

        // Apply specific chart filter if chartSelectedCompanies is set
        if (chartSelectedCompanies.size > 0) {
            distinctCompanies = distinctCompanies.filter(c => chartSelectedCompanies.has(c));
        } else {
            // Default to first 3 if nothing specific selected for the chart
            distinctCompanies = distinctCompanies.slice(0, 3);
        }
        const colors = ['#00B67A', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#10b981'];

        datasets = distinctCompanies.map((comp, cIdx) => {
            const companyHistory = allRawData.filter(r => r.nome_empresa === comp);

            const dataPoints = monthsToShow.map(mNum => {
                if (!availableMonths.has(mNum)) return null;
                return window.calculateHealthScore(companyHistory, currentYear, mNum);
            });

            return {
                label: comp,
                data: dataPoints,
                borderColor: colors[cIdx % colors.length],
                backgroundColor: 'transparent',
                borderWidth: 2,
                tension: 0.4,
                fill: false,
                pointRadius: 3,
                spanGaps: true,
                clip: false
            };
        });
    }

    consolidatedChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    top: 25,
                    right: 20,
                    left: 20,
                    bottom: 5
                }
            },
            interaction: { mode: 'nearest', intersect: true },
            plugins: {
                legend: {
                    display: mode === 'companies',
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 8,
                        font: { family: "'Inter', sans-serif", size: 11 },
                        color: '#6b7280'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => ` ${context.dataset.label}: ${Math.round(context.parsed.y)}%`
                    },
                    backgroundColor: '#1a1a1a',
                    titleFont: { family: "'Inter', sans-serif" },
                    bodyFont: { family: "'Inter', sans-serif" },
                    borderColor: '#00B67A',
                    borderWidth: 1,
                    cornerRadius: 4,
                    padding: 10
                },
                datalabels: {
                    align: 'top',
                    anchor: 'end',
                    offset: 6,
                    formatter: (value) => value !== null ? Math.round(value) + '%' : '',
                    font: {
                        family: "'Inter', sans-serif",
                        size: 10,
                        weight: '700'
                    },
                    backgroundColor: (context) => context.dataset.borderColor,
                    borderRadius: 4,
                    padding: {
                        top: 2,
                        bottom: 2,
                        left: 4,
                        right: 4
                    },
                    color: '#ffffff',
                    display: (context) => context.dataset.data[context.dataIndex] !== null,
                    clip: false,
                    listeners: {
                        enter: (context) => {
                            context.hovered = true;
                            return true;
                        },
                        leave: (context) => {
                            context.hovered = false;
                            return true;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--chart-grid').trim() },
                    ticks: {
                        stepSize: 20,
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim(),
                        callback: v => v + '%',
                        font: { family: "'Inter', sans-serif" }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim(),
                        font: { family: "'Inter', sans-serif" }
                    }
                }
            }
        }
    });
}

// Modal Logic
function openClientModal(client, clientIndex) {
    const modal = document.getElementById('clientModal');

    document.getElementById('modalClientName').textContent = client.name;
    document.getElementById('modalClientId').textContent = `Código: ${client.codigo}`;

    // Select the current dashboard month in the modal filter by default if available
    const modalSelect = document.getElementById('modalMonthFilter');
    // Try to match current dashboard selection
    const targetVal = `${currentYear}-${currentMonth + 1}`;
    if (modalSelect.querySelector(`option[value="${targetVal}"]`)) {
        modalSelect.value = targetVal;
    }

    modal.dataset.clientIndex = clientIndex;

    // Use onchange property to ensure we replace any previous listener for a different client
    // This avoids listener stacking and ensures 'client' refers to the currently opened client
    modalSelect.onchange = () => {
        updateModalData(client);
    };

    updateModalData(client);
    modal.classList.remove('hidden');
}

function updateModalData(client) {
    const history = client.history || [];
    const modalSelect = document.getElementById('modalMonthFilter');

    // Parse selected Year-Month
    const parts = modalSelect.value.split('-');
    if (parts.length < 2) return;

    if (parts.length < 2) return;

    const selYear = parseInt(parts[0]);
    const selMonth = parseInt(parts[1]);

    // Find record in global allRawData for this client + year + month
    // We match by client name (e.g. "AZUL", "GOL"). verify `client.name`.
    const currentRecord = allRawData.find(r =>
        r.nome_empresa === client.name &&
        r.ano === selYear &&
        r.mes === selMonth
    );

    // Find previous month
    let prevYear = selYear;
    let prevMonth = selMonth - 1;
    if (prevMonth < 1) { prevMonth = 12; prevYear--; }

    const prevRecord = allRawData.find(r =>
        r.nome_empresa === client.name &&
        r.ano === prevYear &&
        r.mes === prevMonth
    );

    const currentData = currentRecord || {
        total_servicos: 0,
        total_alteracoes_escala: 0,
        total_tripulantes: 0,
        total_veiculos: 0
    };

    const prevData = prevRecord || {
        total_servicos: 0,
        total_alteracoes_escala: 0,
        total_tripulantes: 0,
        total_veiculos: 0
    };

    // Calculate trends
    const scaleTrend = calculateTrend(currentData.total_alteracoes_escala, prevData.total_alteracoes_escala);
    const tripTrend = calculateTrend(currentData.total_servicos, prevData.total_servicos);
    const crewTrend = calculateTrend(currentData.total_tripulantes, prevData.total_tripulantes);
    const vehTrend = calculateTrend(currentData.total_veiculos, prevData.total_veiculos);

    // Update Cards with Integer values
    updateKpiCard('modalKpiScale', 'modalTrendScale', Math.round(currentData.total_alteracoes_escala), scaleTrend.percent);
    updateKpiCard('modalKpiTrip', 'modalTrendTrip', Math.round(currentData.total_servicos), tripTrend.percent);
    updateKpiCard('modalKpiCrew', 'modalTrendCrew', Math.round(currentData.total_tripulantes), crewTrend.percent);
    updateKpiCard('modalKpiVeh', 'modalTrendVeh', Math.round(currentData.total_veiculos), vehTrend.percent);

    // Update Chart with full history for this client
    // Get all history for this client from allRawData
    const fullHistory = allRawData.filter(r => r.nome_empresa === client.name).sort((a, b) => {
        if (a.ano !== b.ano) return a.ano - b.ano;
        return a.mes - b.mes;
    });

    renderModalChart(fullHistory);
}

function updateKpiCard(valId, trendId, value, trendPct) {
    document.getElementById(valId).textContent = value.toLocaleString();
    const trendEl = document.getElementById(trendId);
    const trendVal = parseFloat(trendPct);

    const colorClass = trendVal < 0 ? 'color-red' : 'color-green';
    const sign = trendVal > 0 ? '+' : '';

    trendEl.className = `kpi-trend ${colorClass}`;
    trendEl.textContent = `${sign}${trendVal}%`;
}

function renderModalChart(history) {
    const ctx = document.getElementById('clientMainChart').getContext('2d');
    if (activeChart) activeChart.destroy();

    // Calculate Health Score for full history or displayed period
    const dataPoints = history.map(r => {
        // Calculate score for each point in history
        if (typeof window.calculateHealthScore === 'function') {
            // We pass the full history array so calculateHealthScore can look back for any year/month
            return window.calculateHealthScore(history, r.ano, r.mes);
        }
        return 0;
    });

    const labels = history.map(r => {
        const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
        return `${monthNames[r.mes - 1]}/${r.ano}`;
    });

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(0, 182, 122, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 182, 122, 0.0)');

    activeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Índice de Utilização',
                data: dataPoints,
                borderColor: '#00B67A',
                backgroundColor: gradient,
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    top: 25,
                    right: 20,
                    left: 20,
                    bottom: 5
                }
            },
            interaction: { mode: 'nearest', intersect: true },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--chart-grid').trim() },
                    ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => `Utilização: ${Math.round(context.parsed.y)}%`
                    },
                    backgroundColor: '#1a1a1a',
                    titleColor: '#ffffff',
                    bodyColor: '#ffffff',
                    borderColor: '#00B67A',
                    borderWidth: 1
                },
                datalabels: {
                    align: 'top',
                    anchor: 'end',
                    offset: 6,
                    formatter: (value) => value !== null ? Math.round(value) + '%' : '',
                    font: {
                        family: "'Inter', sans-serif",
                        size: 10,
                        weight: '700'
                    },
                    backgroundColor: '#00B67A',
                    borderRadius: 4,
                    padding: {
                        top: 2,
                        bottom: 2,
                        left: 4,
                        right: 4
                    },
                    color: '#ffffff',
                    display: (context) => context.dataset.data[context.dataIndex] !== null,
                    clip: false
                }
            }
        }
    });
}

// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
    const monthSelect = document.getElementById('globalMonthFilter');
    const yearSelect = document.getElementById('globalYearFilter');

    // Initial population will happen after data load

    monthSelect.addEventListener('change', (e) => {
        currentMonth = parseInt(e.target.value);
        if (typeof window.transformDataForDashboard === 'function') {
            allClientsData = window.transformDataForDashboard(allRawData, currentYear, currentMonth);
        }
        updateMonthHeaders();
        renderTable();
    });

    yearSelect.addEventListener('change', (e) => {
        currentYear = parseInt(e.target.value);
        if (typeof window.updateGlobalMonths === 'function') {
            window.updateGlobalMonths();
        } else {
            // Fallback if not ready
            if (typeof window.transformDataForDashboard === 'function') {
                allClientsData = window.transformDataForDashboard(allRawData, currentYear, currentMonth);
            }
            updateMonthHeaders();
            renderTable();
        }
    });

    await loadAndRenderData();

    // Modal Events
    const closeModalBtn = document.getElementById('closeModalBtn');
    const modal = document.getElementById('clientModal');

    closeModalBtn.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    });

    // Modal Filter Change
    const modalFilter = document.getElementById('modalMonthFilter');
    if (modalFilter) {
        modalFilter.addEventListener('change', () => {
            const clientIndex = document.getElementById('clientModal').dataset.clientIndex;
            if (clientIndex !== undefined && allClientsData[clientIndex]) {
                updateModalData(allClientsData[clientIndex]);
            }
        });
    }

    // Theme Toggle
    const themeToggle = document.getElementById('themeToggle');
    const updateThemeIcon = (theme) => {
        const icon = themeToggle.querySelector('i');
        icon.className = theme === 'dark' ? 'ph ph-sun' : 'ph ph-moon';
    };
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
        if (consolidatedChart) {
            const activeBtn = document.querySelector('.chart-toggle-btn.active');
            renderConsolidatedChart(activeBtn ? activeBtn.dataset.mode : 'consolidated');
        }
    });

    // Toggle View
    const toggleBtn = document.getElementById('toggleConsolidatedBtn');
    const consolidatedSection = document.getElementById('consolidatedSection');

    toggleBtn.addEventListener('click', () => {
        consolidatedSection.classList.toggle('collapsed');
        toggleBtn.classList.toggle('rotated');
    });

    // Chart View Toggles
    const chartToggleBtns = document.querySelectorAll('.chart-toggle-btn');
    chartToggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active from all
            chartToggleBtns.forEach(b => b.classList.remove('active'));
            // Add to clicked
            btn.classList.add('active');

            // Render chart
            const mode = btn.dataset.mode;

            // Show/Hide chart filter button
            const openChartFilterBtn = document.getElementById('openChartFilterBtn');
            if (openChartFilterBtn) {
                if (mode === 'companies') {
                    openChartFilterBtn.classList.remove('hidden');
                } else {
                    openChartFilterBtn.classList.add('hidden');
                }
            }

            if (window.renderConsolidatedChart) {
                renderConsolidatedChart(mode);
            }
        });
    });

    // Chart Company Selection Modal
    const chartCompanyModal = document.getElementById('chartCompanyModal');
    const openChartFilterBtn = document.getElementById('openChartFilterBtn');
    const closeChartCompanyModalBtn = document.getElementById('closeChartCompanyModalBtn');
    const applyChartSettingsBtn = document.getElementById('applyChartSettingsBtn');

    if (openChartFilterBtn && chartCompanyModal) {
        openChartFilterBtn.addEventListener('click', () => {
            populateChartCompanySelector();
            chartCompanyModal.classList.remove('hidden');
        });
        if (closeChartCompanyModalBtn) {
            closeChartCompanyModalBtn.addEventListener('click', () => chartCompanyModal.classList.add('hidden'));
        }
        if (applyChartSettingsBtn) {
            applyChartSettingsBtn.addEventListener('click', () => {
                const checked = chartCompanyModal.querySelectorAll('.chart-client-check:checked');
                chartSelectedCompanies.clear();
                checked.forEach(cb => chartSelectedCompanies.add(cb.value));
                chartCompanyModal.classList.add('hidden');
                renderConsolidatedChart('companies');
            });
        }

        chartCompanyModal.addEventListener('click', (e) => {
            if (e.target === chartCompanyModal) chartCompanyModal.classList.add('hidden');
        });
    }

    // --- New Table Settings Modal Logic ---

    const settingsModal = document.getElementById('tableSettingsModal');
    const openSettingsBtn = document.getElementById('openTableFiltersBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsModalBtn');
    const applySettingsBtn = document.getElementById('applySettingsBtn');

    if (openSettingsBtn && settingsModal) {
        openSettingsBtn.addEventListener('click', () => {
            settingsModal.classList.remove('hidden');
        });

        if (closeSettingsBtn) {
            closeSettingsBtn.addEventListener('click', () => {
                settingsModal.classList.add('hidden');
            });
        }

        if (applySettingsBtn) {
            applySettingsBtn.addEventListener('click', () => {
                settingsModal.classList.add('hidden');
            });
        }

        // Close on backlight click
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.add('hidden');
            }
        });
    }

    // Modal Client Search (Filters the list of checkboxes)
    const modalSearchInput = document.getElementById('modalClientSearch');
    if (modalSearchInput) {
        modalSearchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const items = document.querySelectorAll('#modalClientList .col-check-item');
            items.forEach(item => {
                const name = item.querySelector('span').textContent.toLowerCase();
                if (name.includes(term)) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    }

    populateClientSelector();

    // Sorting radio buttons in modal
    const sortRadios = document.querySelectorAll('.sort-radio');
    sortRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                currentSort = e.target.value;
                renderTable();
            }
        });
    });

    // Modal Column Toggles (Live Toggle)
    const modalCheckboxes = document.querySelectorAll('.modal-col-check');
    modalCheckboxes.forEach(cb => {
        cb.addEventListener('change', (e) => {
            const group = e.target.dataset.group;
            const isVisible = e.target.checked;
            toggleColumnGroup(group, isVisible);
        });
    });
});

function populateClientSelector() {
    const list = document.getElementById('modalClientList');
    if (!list || !allRawData || allRawData.length === 0) return;

    // Unique client names
    const clients = [...new Set(allRawData.map(r => r.nome_empresa))].sort();

    // Reset selectedClients if it's the first time
    if (selectedClients.size === 0) {
        clients.forEach(c => selectedClients.add(c));
    }

    list.innerHTML = '';
    clients.forEach(name => {
        const isChecked = selectedClients.has(name);
        const label = document.createElement('label');
        label.className = 'col-check-item';
        label.innerHTML = `
            <input type="checkbox" ${isChecked ? 'checked' : ''} class="client-filter-check" data-client="${name}">
            <span>${name}</span>
        `;
        list.appendChild(label);
    });

    // Add listeners
    const checks = list.querySelectorAll('.client-filter-check');
    checks.forEach(cb => {
        cb.addEventListener('change', () => {
            const clientName = cb.dataset.client;
            if (cb.checked) {
                selectedClients.add(clientName);
            } else {
                selectedClients.delete(clientName);
            }
            renderTable(); // Live update main table
            calculateConsolidatedData(); // Update charts to reflect filtered portfolio
        });
    });
}

function toggleColumnGroup(groupClass, isVisible) {
    // Update the visibleColumns Set
    if (isVisible) {
        visibleColumns.add(groupClass);
    } else {
        visibleColumns.delete(groupClass);
    }

    // Re-render headers and table
    updateMonthHeaders();
    renderTable();
}

// Apply current sorting to data
function applySorting(data) {
    const filtered = data.filter(client => {
        if (selectedClients.size > 0 && !selectedClients.has(client.name)) {
            return false;
        }
        return true;
    });

    if (currentSort === 'alpha-asc') {
        return filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else if (currentSort === 'alpha-desc') {
        return filtered.sort((a, b) => b.name.localeCompare(a.name));
    } else if (currentSort === 'usage') {
        // Sort by most recent utilization score (highest first)
        return filtered.sort((a, b) => {
            const aMetrics = a.metrics || [];
            const bMetrics = b.metrics || [];
            const aUsage = aMetrics.length > 0 ? aMetrics[aMetrics.length - 1].usage[1] : 0;
            const bUsage = bMetrics.length > 0 ? bMetrics[bMetrics.length - 1].usage[1] : 0;
            return bUsage - aUsage;
        });
    }
    return filtered;
}

function populateChartCompanySelector() {
    const list = document.getElementById('chartCompanyList');
    if (!list || !allRawData || allRawData.length === 0) return;

    // We only show companies that are ALREADY in selectedClients (globally selected)
    let clients = [...new Set(allRawData.map(r => r.nome_empresa))].sort();
    if (selectedClients.size > 0) {
        clients = clients.filter(c => selectedClients.has(c));
    }

    list.innerHTML = clients.map(client => {
        const isChecked = chartSelectedCompanies.has(client);
        return `
            <label class="col-check-item">
                <input type="checkbox" value="${client}" ${isChecked ? 'checked' : ''} class="chart-client-check">
                <span>${client}</span>
            </label>
        `;
    }).join('');

    // Limit to 3 logic
    const checkboxes = list.querySelectorAll('.chart-client-check');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            const checkedCount = list.querySelectorAll('.chart-client-check:checked').length;
            if (checkedCount > 3) {
                cb.checked = false;
            }
        });
    });
}
