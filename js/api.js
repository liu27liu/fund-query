/**
 * 基金数据API接口层
 * 通过本地后端代理请求东方财富/天天基金实时数据
 * 所有数据实时、准确,无任何模拟数据
 */
const FundAPI = (function () {

    // ========== 通用请求工具 ==========

    async function fetchJSON(url, timeout = 10000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const resp = await fetch(url, {
                signal: controller.signal,
                cache: 'no-cache'
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return await resp.json();
        } finally {
            clearTimeout(timer);
        }
    }

    // ========== 基金搜索 ==========

    /**
     * 基金搜索(支持代码/名称/拼音)
     */
    async function searchFunds(keyword) {
        if (!keyword || keyword.trim().length < 1) return [];
        try {
            const resp = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword: keyword.trim() })
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            if (Array.isArray(data)) return data;
            return [];
        } catch (e) {
            console.warn('搜索接口异常:', e);
            return [];
        }
    }

    // ========== 实时估值 ==========

    /**
     * 获取基金实时估值
     */
    async function getRealtimeEstimate(fundCode) {
        try {
            const data = await fetchJSON('/api/estimate?code=' + fundCode, 8000);
            if (data && data.fundcode) {
                return {
                    fundcode: data.fundcode,
                    name: data.name || '',
                    jzrq: data.jzrq || '',
                    dwjz: data.dwjz || 0,
                    gsz: data.gsz || 0,
                    gszzl: data.gszzl || 0,
                    gztime: data.gztime || ''
                };
            }
            return null;
        } catch (e) {
            console.warn('实时估值接口异常:', fundCode, e);
            return null;
        }
    }

    /**
     * 批量获取实时估值
     */
    async function batchRealtimeEstimate(fundCodes) {
        if (!fundCodes || fundCodes.length === 0) return [];
        try {
            const data = await fetchJSON('/api/estimate/batch?codes=' + fundCodes.join(','), 15000);
            if (Array.isArray(data)) return data;
            return [];
        } catch (e) {
            console.warn('批量估值接口异常:', e);
            // 降级为逐个请求
            const promises = fundCodes.map(function (code) {
                return getRealtimeEstimate(code).catch(function () { return null; });
            });
            const results = await Promise.all(promises);
            return results.filter(function (r) { return r !== null; });
        }
    }

    // ========== 历史净值数据 ==========

    /**
     * 获取基金历史净值列表
     */
    async function getHistoryNav(fundCode, pageIndex, pageSize, startDate, endDate) {
        pageIndex = pageIndex || 1;
        pageSize = pageSize || 20;
        var url = '/api/history?code=' + fundCode + '&page=' + pageIndex + '&size=' + pageSize;
        if (startDate) url += '&startDate=' + startDate;
        if (endDate) url += '&endDate=' + endDate;

        try {
            const data = await fetchJSON(url);
            if (data && data.list) {
                return {
                    total: data.total || 0,
                    list: data.list.map(function (item) {
                        return {
                            date: item.date || '',
                            dwjz: item.dwjz || 0,
                            ljjz: item.ljjz || 0,
                            change: item.change || 0
                        };
                    })
                };
            }
            return { total: 0, list: [] };
        } catch (e) {
            console.warn('历史净值接口异常:', fundCode, e);
            return { total: 0, list: [] };
        }
    }

    /**
     * 获取基金净值走势数据
     */
    async function getNavTrend(fundCode) {
        try {
            const data = await fetchJSON('/api/trend?code=' + fundCode, 15000);
            if (!data) return null;

            var result = {
                name: data.name || '',
                code: data.code || fundCode,
                netWorthTrend: [],
                acWorthTrend: [],
                currentFundManager: data.currentFundManager || '',
                syl: data.syl || {}
            };

            if (data.netWorthTrend && Array.isArray(data.netWorthTrend)) {
                result.netWorthTrend = data.netWorthTrend.map(function (item) {
                    return {
                        date: new Date(item.timestamp || item.date),
                        timestamp: item.timestamp || item.date,
                        netValue: item.netValue,
                        change: item.change || 0
                    };
                });
            }

            if (data.acWorthTrend && Array.isArray(data.acWorthTrend)) {
                result.acWorthTrend = data.acWorthTrend.map(function (item) {
                    return {
                        date: new Date(item.timestamp || item.date),
                        timestamp: item.timestamp || item.date,
                        netValue: item.netValue
                    };
                });
            }

            return result;
        } catch (e) {
            console.warn('净值走势接口异常:', fundCode, e);
            return null;
        }
    }

    // ========== 基金详情信息 ==========

    /**
     * 获取基金基础信息
     */
    async function getFundDetail(fundCode) {
        try {
            const data = await fetchJSON('/api/detail?code=' + fundCode);
            if (data && data.code) {
                return {
                    code: data.code,
                    name: data.name || '',
                    type: data.type || '',
                    typeDesc: data.typeDesc || parseFundType(data.type || ''),
                    company: data.company || '--',
                    manager: data.manager || '--',
                    establishDate: data.establishDate || '--',
                    scale: data.scale || '--',
                    netValue: data.netValue || 0,
                    netValueDate: data.netValueDate || '',
                    totalNetValue: data.totalNetValue || 0,
                    change: data.change || 0,
                    weekChange: data.weekChange || 0,
                    monthChange: data.monthChange || 0,
                    seasonChange: data.seasonChange || 0,
                    yearChange: data.yearChange || 0
                };
            }
            return null;
        } catch (e) {
            console.warn('基金详情接口异常:', fundCode, e);
            return null;
        }
    }

    /**
     * 获取基金涨幅排行
     * @param {string} sortType - 排序类型 RZDF=日涨幅
     * @param {number} pageSize - 数量
     * @param {string} order - desc=降序(涨幅榜), asc=升序(跌幅榜)
     */
    async function getFundRanking(sortType, pageSize, order, fundType, page) {
        sortType = sortType || 'RZDF';
        pageSize = pageSize || 10;
        order = order || 'desc';
        fundType = fundType || 'all';
        page = page || 1;
        try {
            const data = await fetchJSON('/api/ranking?sort=' + sortType + '&size=' + pageSize + '&order=' + order + '&type=' + fundType + '&page=' + page);
            // 兼容新旧格式：新格式{funds:[], total:N}，旧格式[]
            if (data && data.funds) return data.funds;
            if (Array.isArray(data)) return data;
            return [];
        } catch (e) {
            console.warn('基金排行接口异常:', e);
            return [];
        }
    }

    async function getFundRankingWithTotal(sortType, pageSize, order, fundType, page) {
        sortType = sortType || 'RZDF';
        pageSize = pageSize || 10;
        order = order || 'desc';
        fundType = fundType || 'all';
        page = page || 1;
        try {
            const data = await fetchJSON('/api/ranking?sort=' + sortType + '&size=' + pageSize + '&order=' + order + '&type=' + fundType + '&page=' + page);
            if (data && data.funds) return { funds: data.funds, total: data.total || 0 };
            if (Array.isArray(data)) return { funds: data, total: data.length };
            return { funds: [], total: 0 };
        } catch (e) {
            console.warn('基金排行接口异常:', e);
            return { funds: [], total: 0 };
        }
    }

    /**
     * 热门基金池 - 每天随机展示8只
     */
    var HOT_FUND_POOL = [
        { code: '110011', name: '易方达优质精选混合', type: '混合型' },
        { code: '161725', name: '招商中证白酒指数', type: '指数型' },
        { code: '005827', name: '易方达蓝筹精选混合', type: '混合型' },
        { code: '163406', name: '兴全合润混合', type: '混合型' },
        { code: '260108', name: '景顺长城新兴成长混合', type: '混合型' },
        { code: '519674', name: '银河创新成长混合', type: '混合型' },
        { code: '008888', name: '华夏国证半导体芯片ETF联接', type: '指数型' },
        { code: '161903', name: '万家行业优选混合', type: '混合型' },
        { code: '270042', name: '广发纳指100ETF联接', type: '指数型' },
        { code: '320007', name: '诺安成长混合', type: '混合型' },
        { code: '001102', name: '前海开源国家比较优势混合', type: '混合型' },
        { code: '162605', name: '景顺长城鼎益混合', type: '混合型' },
        { code: '519066', name: '汇添富蓝筹稳健混合', type: '混合型' },
        { code: '000961', name: '天弘沪深300指数', type: '指数型' },
        { code: '001643', name: '汇添富中证主要消费ETF联接', type: '指数型' },
        { code: '005918', name: '天弘中证医药100指数', type: '指数型' },
        { code: '000478', name: '嘉实新能源材料股票', type: '股票型' },
        { code: '110003', name: '易方达50指数A', type: '指数型' },
        { code: '180003', name: '银华-道琼斯88精选', type: '指数型' },
        { code: '360013', name: '光大保德信优势配置混合', type: '混合型' },
        { code: '012414', name: '嘉实中证科创创业50ETF联接', type: '指数型' },
        { code: '001856', name: '国泰互联网+股票', type: '股票型' },
        { code: '166009', name: '中欧新动力混合', type: '混合型' },
        { code: '002340', name: '华夏行业景气混合', type: '混合型' }
    ];

    /**
     * 获取热门基金列表 - 基于当天日期随机选取8只，每天更换
     */
    function getHotFunds() {
        // 用当天日期作为种子，保证同一天显示相同的基金
        var today = new Date();
        var seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
        
        // Fisher-Yates 洗牌（基于种子）
        var arr = HOT_FUND_POOL.slice();
        var random = function () {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(random() * (i + 1));
            var temp = arr[i];
            arr[i] = arr[j];
            arr[j] = temp;
        }
        return arr.slice(0, 8);
    }

    /**
     * 热门搜索关键词
     */
    function getHotKeywords() {
        return [
            '白酒', '新能源', '半导体', '医药', '消费',
            '科技', '军工', '光伏', '创业板', '沪深300',
            '中证500', '纳指', '债基', '黄金', '红利'
        ];
    }

    // ========== 同花顺基金列表 ==========

    /**
     * 获取基金列表(同花顺数据源)
     * @param {object} params - {type, sort, order, page, size, keyword}
     */
    async function getFundList(params) {
        var query = Object.keys(params || {}).map(function (k) {
            return k + '=' + encodeURIComponent(params[k] || '');
        }).join('&');
        try {
            return await fetchJSON('/api/fund-list?' + query, 20000);
        } catch (e) {
            console.warn('基金列表接口异常:', e);
            return { funds: [], total: 0, page: 1, size: 50 };
        }
    }

    // ========== 辅助函数 ==========

    function parseFundType(typeCode) {
        if (!typeCode) return '混合型';
        var typeStr = String(typeCode);
        var typeMap = {
            '001': '股票型', '002': '股票型', '003': '股票型',
            '025': '股票型', '026': '指数型',
            '027': '混合型', '028': '混合型', '029': '混合型',
            '061': '债券型', '062': '债券型', '063': '债券型',
            '064': '债券型', '065': '债券型',
            '016': 'LOF', '017': 'LOF',
            '006': 'QDII', '007': 'QDII',
            '050': '货币型', '051': '货币型',
            '052': '货币型', '053': '货币型',
            '090': 'FOF'
        };
        if (typeMap[typeStr]) return typeMap[typeStr];
        for (var key in typeMap) {
            if (typeStr.indexOf(key) !== -1) return typeMap[key];
        }
        if (typeStr.indexOf('债') !== -1) return '债券型';
        if (typeStr.indexOf('指数') !== -1 || typeStr.indexOf('ETF') !== -1) return '指数型';
        if (typeStr.indexOf('货币') !== -1) return '货币型';
        if (typeStr.indexOf('QDII') !== -1) return 'QDII';
        if (typeStr.indexOf('股票') !== -1) return '股票型';
        return '混合型';
    }

    function getTypeColor(type) {
        var colorMap = {
            '股票型': '#ff4d4f',
            '混合型': '#1677ff',
            '债券型': '#52c41a',
            '指数型': '#722ed1',
            '货币型': '#13c2c2',
            'QDII': '#fa8c16',
            'LOF': '#eb2f96',
            'FOF': '#2f54eb'
        };
        return colorMap[type] || '#8c8c8c';
    }

    function formatNum(num, digits) {
        digits = digits || 4;
        if (num === null || num === undefined || isNaN(num)) return '--';
        return parseFloat(num).toFixed(digits);
    }

    function formatChange(change) {
        if (change === null || change === undefined || isNaN(change)) return '--';
        var val = parseFloat(change).toFixed(2);
        return (change > 0 ? '+' : '') + val + '%';
    }

    function getChangeClass(change) {
        if (change > 0) return 'up';
        if (change < 0) return 'down';
        return 'flat';
    }

    function formatDate(date, format) {
        format = format || 'YYYY-MM-DD';
        if (!date) return '--';
        var d = new Date(date);
        if (isNaN(d.getTime())) return String(date);
        // 使用 Asia/Shanghai 时区（UTC+8），避免服务器UTC时区导致时间偏差
        var tzOffset = 8 * 60; // 上海时区偏移（分钟）
        var localOffset = d.getTimezoneOffset(); // 当前环境时区偏移（分钟）
        var offsetDiff = tzOffset + localOffset; // 需要调整的分钟差
        var adjusted = new Date(d.getTime() + offsetDiff * 60 * 1000);
        var y = adjusted.getFullYear();
        var m = String(adjusted.getMonth() + 1).padStart(2, '0');
        var day = String(adjusted.getDate()).padStart(2, '0');
        var h = String(adjusted.getHours()).padStart(2, '0');
        var min = String(adjusted.getMinutes()).padStart(2, '0');
        var sec = String(adjusted.getSeconds()).padStart(2, '0');
        return format
            .replace('YYYY', y)
            .replace('MM', m)
            .replace('DD', day)
            .replace('HH', h)
            .replace('mm', min)
            .replace('ss', sec);
    }

    // ========== 7x24实时资讯 ==========
    var newsSortEnd = ''; // 分页游标

    async function getNews(page, pageSize) {
        pageSize = pageSize || 15;
        // 第一页不传sortEnd（获取最新），翻页时传上一页返回的sortEnd
        var params = 'size=' + pageSize;
        if (page > 1 && newsSortEnd) {
            params += '&sortEnd=' + encodeURIComponent(newsSortEnd);
        }
        try {
            const data = await fetchJSON('/api/news?' + params);
            if (data && Array.isArray(data.list)) {
                // 保存分页游标
                if (data.sortEnd) newsSortEnd = data.sortEnd;
                return data.list;
            }
            return [];
        } catch (e) {
            console.warn('资讯接口异常:', e);
            return [];
        }
    }

    // ========== 大盘指数实时行情 ==========
    async function getMarketIndices() {
        try {
            const data = await fetchJSON('/api/market-indices');
            if (Array.isArray(data)) return data;
            return [];
        } catch (e) {
            console.warn('大盘指数接口异常:', e);
            return [];
        }
    }

    // ========== 板块行情 (行业板块/概念题材) ==========
    async function getSectors(category) {
        category = category || '行业板块';
        try {
            var url = '/api/sectors?type=' + encodeURIComponent(category);
            const data = await fetchJSON(url, 30000);
            if (Array.isArray(data)) return data;
            return [];
        } catch (e) {
            console.warn('板块接口异常:', e);
            return [];
        }
    }

    async function getSectorCategories() {
        try {
            return await fetchJSON('/api/sector-categories', 5000);
        } catch (e) {
            return ['行业板块', '概念题材'];
        }
    }

    async function getSectorFunds(bkCode, page, size) {
        page = page || 1;
        size = size || 20;
        try {
            var url = '/api/sector-funds?code=' + encodeURIComponent(bkCode) + '&page=' + page + '&size=' + size;
            const data = await fetchJSON(url, 15000);
            if (data && Array.isArray(data.funds)) return data;
            return { funds: [], total: 0, page: page, size: size };
        } catch (e) {
            console.warn('板块基金接口异常:', e);
            return { funds: [], total: 0, page: page, size: size };
        }
    }

    // ========== 基金经理排行榜 ==========
    async function getFundManagers(page, pageSize, fundType) {
        page = page || 1;
        pageSize = pageSize || 20;
        fundType = fundType || 'all';
        try {
            const data = await fetchJSON('/api/fund-managers?page=' + page + '&size=' + pageSize + '&type=' + fundType);
            if (data && Array.isArray(data.list)) return data;
            return { list: [], total: 0, pages: 0 };
        } catch (e) {
            console.warn('基金经理接口异常:', e);
            return { list: [], total: 0, pages: 0 };
        }
    }

    // ========== 基金重仓股 ==========
    async function getFundHoldings(fundCode) {
        try {
            var resp = await fetch('/api/fund-holdings?code=' + encodeURIComponent(fundCode));
            return await resp.json();
        } catch (e) {
            console.error('getFundHoldings error:', e);
            return { list: [], reportDate: '', stockRatio: 0 };
        }
    }

    return {
        searchFunds: searchFunds,
        getRealtimeEstimate: getRealtimeEstimate,
        batchRealtimeEstimate: batchRealtimeEstimate,
        getHistoryNav: getHistoryNav,
        getNavTrend: getNavTrend,
        getFundDetail: getFundDetail,
        getFundRanking: getFundRanking,
        getFundRankingWithTotal: getFundRankingWithTotal,
        getHotFunds: getHotFunds,
        getHotKeywords: getHotKeywords,
        getFundList: getFundList,
        getNews: getNews,
        resetNewsCursor: function () { newsSortEnd = ''; },
        getMarketIndices: getMarketIndices,
        getSectors: getSectors,
        getSectorCategories: getSectorCategories,
        getSectorFunds: getSectorFunds,
        getFundManagers: getFundManagers,
        getFundHoldings: getFundHoldings,
        parseFundType: parseFundType,
        getTypeColor: getTypeColor,
        formatNum: formatNum,
        formatChange: formatChange,
        getChangeClass: getChangeClass,
        formatDate: formatDate
    };
})();
