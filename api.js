console.log('📦 API: carregando módulo api.js...');
// Supabase Configuration
if (typeof SUPABASE_URL === 'undefined') {
    var SUPABASE_URL = "https://xmzpavpuiqaftdlkvzed.supabase.co";
}
if (typeof SUPABASE_ANON_KEY === 'undefined') {
    var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtenBhdnB1aXFhZnRkbGt2emVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzMTU1ODMsImV4cCI6MjA4Mzg5MTU4M30.8C7L0N0Ow87gqwDpCj-N6I8ryWp5YLi0EAQUan7N8QA";
}

// Initialize Supabase client
if (typeof supabaseClient === 'undefined') {
    var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Export functions to global scope early
window.fetchAllMetrics = fetchAllMetrics;
window.fetchMetricsByMonth = fetchMetricsByMonth;
window.fetchMetricsByCompany = fetchMetricsByCompany;
window.getCompanyNames = getCompanyNames;
window.transformDataForDashboard = transformDataForDashboard;
window.calculateHealthScore = calculateHealthScore;
window.getHistoricalData = getHistoricalData;

/**
 * Fetch all metrics from Supabase
 * @returns {Promise<Array>} Array of metric records
 */
async function fetchAllMetrics() {
    try {
        console.log('🔌 Supabase: Iniciando select na tabela indicadores_uso_mensal...');
        const { data, error } = await supabaseClient
            .from('indicadores_uso_mensal')
            .select('*')
            .order('ano', { ascending: true })
            .order('mes', { ascending: true });

        if (error) {
            console.error('❌ Supabase Error:', error);
            throw error;
        }

        console.log('✅ Supabase: Dados recebidos com sucesso. Total de linhas:', data ? data.length : 0);
        if (data && data.length > 0) {
            console.log('📝 Primeiro registro:', data[0]);
        }
        return data || [];
    } catch (error) {
        console.error('❌ Error fetching metrics:', error);
        return [];
    }
}

/**
 * Fetch metrics for a specific month
 * @param {number} year - Year (e.g., 2026)
 * @param {number} month - Month (1-12)
 * @returns {Promise<Array>} Array of metric records for the specified month
 */
async function fetchMetricsByMonth(year, month) {
    try {
        const { data, error } = await supabaseClient
            .from('indicadores_uso_mensal')
            .select('*')
            .eq('ano', year)
            .eq('mes', month);

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error fetching metrics by month:', error);
        return [];
    }
}

/**
 * Fetch metrics for a specific company
 * @param {string} companyName - Company name
 * @returns {Promise<Array>} Array of metric records for the company
 */
async function fetchMetricsByCompany(companyName) {
    try {
        const { data, error } = await supabaseClient
            .from('indicadores_uso_mensal')
            .select('*')
            .eq('nome_empresa', companyName)
            .order('ano', { ascending: true })
            .order('mes', { ascending: true });

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error fetching metrics by company:', error);
        return [];
    }
}

/**
 * Get unique company names from the database
 * @returns {Promise<Array>} Array of unique company names
 */
async function getCompanyNames() {
    try {
        const { data, error } = await supabaseClient
            .from('indicadores_uso_mensal')
            .select('nome_empresa')
            .order('nome_empresa', { ascending: true });

        if (error) throw error;

        // Get unique company names
        const uniqueNames = [...new Set(data.map(item => item.nome_empresa))];
        return uniqueNames;
    } catch (error) {
        console.error('Error fetching company names:', error);
        return [];
    }
}

/**
 * Transform database records into dashboard format
 * @param {Array} records - Database records
 * @param {number} selectedMonth - Selected month (0-11 for JS Date compatibility)
 * @returns {Object} Transformed data grouped by company
 */
/**
 * Get the last 3 months relative to a given year/month
 * @param {number} currentYear 
 * @param {number} currentMonth (0-11)
 * @returns {Array} Array of {month, year, display}
 */
function getPeriodMonths(year, month, count = 3) {
    const months = [];
    const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

    // We go back count - 1 months for the main display,
    // plus 1 extra for the trend of the first month column
    // Total count + 1 items
    for (let i = count; i >= 0; i--) {
        let m = month - i;
        let y = year;

        while (m < 0) {
            m += 12;
            y--;
        }

        months.push({
            month: m + 1, // 1-12 for DB
            index: m,     // 0-11 for JS
            year: y,
            display: monthNames[m]
        });
    }
    return months;
}

/**
 * Calculate Health Score (0-100) for a specific month
 */
function calculateHealthScore(history, targetYear, targetMonth) {
    // 0. Check if client has EVER had operational data (trips or alterations) up to this month
    // If they never had data, they are in 'implantation' and shouldn't count towards usage metrics
    const hasStarted = history.some(r => {
        const isPastOrCurrent = r.ano < targetYear || (r.ano === targetYear && r.mes <= targetMonth);
        const hasData = (r.total_servicos > 0 || r.total_alteracoes_escala > 0);
        return isPastOrCurrent && hasData;
    });

    if (!hasStarted) return null;

    const getRec = (y, m) => history.find(r => r.ano === y && r.mes === m) || { total_servicos: 0, total_alteracoes_escala: 0 };

    // Get Current Activity
    const current = getRec(targetYear, targetMonth);
    const servCurrent = current.total_servicos || 0;
    const altCurrent = current.total_alteracoes_escala || 0;
    const actCurrent = servCurrent + altCurrent;

    // Get Previous 3 Months for Benchmark
    let prevActs = [];
    for (let i = 1; i <= 3; i++) {
        let y = targetYear;
        let m = targetMonth - i;
        if (m < 1) { m += 12; y--; }
        const r = getRec(y, m);
        const vol = (r.total_servicos || 0) + (r.total_alteracoes_escala || 0);
        if (vol > 0) prevActs.push(vol);
    }

    const prevAct = prevActs.length > 0 ? prevActs[0] : 0;

    // 1. Benchmark: Peak Performance (Max of last 3 months)
    const peakHistory = prevActs.length > 0 ? Math.max(...prevActs) : 0;
    const benchmark = Math.max(peakHistory, actCurrent, 100);

    // 2. Activity (0-50)
    const activityScore = 50 * (actCurrent / benchmark);

    // 3. Consistency (0-30)
    let consistencyScore = 0;
    if (actCurrent > 0) {
        if (prevActs.length > 0) {
            const checkWindow = [...prevActs, actCurrent];
            const mean = checkWindow.reduce((a, b) => a + b, 0) / checkWindow.length;
            const variance = checkWindow.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / checkWindow.length;
            const cv = Math.sqrt(variance) / (mean || 1);
            consistencyScore = 30 * Math.exp(-cv * 1.5);
        } else {
            consistencyScore = 20; // Default for first month
        }
    }

    // 4. Depth (0-20)
    let depthScore = 0;
    if (servCurrent > 0) depthScore += 10;
    if (altCurrent > 0) depthScore += 10;

    let totalScore = activityScore + consistencyScore + depthScore;

    // 5. THE RETENTION SLASHER
    // If usage is lower than the previous month, punish the entire score proportionally.
    if (prevAct > 0 && actCurrent < prevAct) {
        const dropRatio = actCurrent / prevAct;
        totalScore *= dropRatio;
    }

    return Math.min(100, Math.max(0, totalScore));
}

/**
 * Transform database records into dashboard format for 3-month view
 * @param {Array} records - Raw database records
 * @param {number} targetYear - Selected year
 * @param {number} targetMonth - Selected month (0-11)
 * @returns {Object} Transformed data grouped by company
 */
function transformDataForDashboard(data, targetYear, targetMonth) {
    if (!data || data.length === 0) return [];

    // 1. Identify the 3-month window ending on targetMonth
    const windowMonths = [];
    for (let i = 2; i >= 0; i--) {
        let m = targetMonth - i;
        let y = targetYear;
        if (m < 0) { m += 12; y--; }
        windowMonths.push({ year: y, month: m + 1 });
    }

    // 2. Filter to only show months that have data
    const displayPeriods = windowMonths.filter(p => {
        return data.some(r => r.ano === p.year && r.mes === p.month);
    });

    if (displayPeriods.length === 0) return [];

    const companiesMap = {};
    data.forEach(record => {
        const companyName = record.nome_empresa;
        if (!companiesMap[companyName]) {
            companiesMap[companyName] = {
                name: companyName,
                codigo: record.codigo_empresa || '---',
                records: []
            };
        }
        companiesMap[companyName].records.push(record);
    });

    const getRecord = (companyRecords, y, m) => {
        return companyRecords.find(r => r.ano === y && r.mes === m) || {
            total_servicos: 0,
            total_veiculos: 0,
            total_tripulantes: 0,
            total_alteracoes_escala: 0
        };
    };

    return Object.values(companiesMap).map(company => {
        const companyHistory = company.records;

        // Map data for display periods
        const metricsData = displayPeriods.map(p => {
            let pm = p.month - 1;
            let py = p.year;
            if (pm < 1) { pm = 12; py--; }

            const currentRec = getRecord(companyHistory, p.year, p.month);
            const prevRec = getRecord(companyHistory, py, pm);

            const currentScore = calculateHealthScore(companyHistory, p.year, p.month);
            const prevScore = calculateHealthScore(companyHistory, py, pm);

            return {
                display: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][p.month - 1],
                year: p.year,
                month: p.month,
                scale: [prevRec.total_alteracoes_escala || 0, currentRec.total_alteracoes_escala || 0],
                trips: [prevRec.total_servicos || 0, currentRec.total_servicos || 0],
                crew: [prevRec.total_tripulantes || 0, currentRec.total_tripulantes || 0],
                vehicles: [prevRec.total_veiculos || 0, currentRec.total_veiculos || 0],
                usage: [prevScore, currentScore]
            };
        });

        return {
            name: company.name,
            codigo: company.codigo,
            history: companyHistory,
            displayPeriods: displayPeriods.map((p, i) => ({
                ...p,
                display: metricsData[i].display
            })),
            metrics: metricsData
        };
    });
}

/**
 * Calculate historical data for charts
 * @param {Array} records - All records for a company
 * @param {string} metric - Metric name (servicos, veiculos, tripulantes, alteracoes)
 * @returns {Array} Array of {date, value} objects
 */
function getHistoricalData(records, metric) {
    const fieldMap = {
        'servicos': 'total_servicos',
        'veiculos': 'total_veiculos',
        'tripulantes': 'total_tripulantes',
        'alteracoes': 'total_alteracoes_escala'
    };

    const field = fieldMap[metric];
    if (!field) return [];

    return records.map(record => ({
        date: `${record.ano}-${String(record.mes).padStart(2, '0')}-15`, // Use mid-month as date
        value: record[field] || 0,
        year: record.ano,
        month: record.mes
    })).sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        return a.month - b.month;
    });
}

// Export functions to global scope for use in script.js
window.fetchAllMetrics = fetchAllMetrics;
window.fetchMetricsByMonth = fetchMetricsByMonth;
window.fetchMetricsByCompany = fetchMetricsByCompany;
window.getCompanyNames = getCompanyNames;
window.transformDataForDashboard = transformDataForDashboard;
window.getHistoricalData = getHistoricalData;
