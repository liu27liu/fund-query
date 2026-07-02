/**
 * 本地存储管理模块
 * 管理自选基金、分组、搜索历史、持仓管理
 */
const Store = (function () {

    var FAV_KEY = 'fund_favorites';
    var GROUPS_KEY = 'fund_fav_groups';
    var HISTORY_KEY = 'fund_search_history';
    var HOLDINGS_KEY = 'fund_holdings';
    var DEFAULT_GROUP = '全部';

    // ========== 自选基金 ==========

    /**
     * 获取所有自选基金
     */
    function getFavorites() {
        try {
            var data = localStorage.getItem(FAV_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    }

    /**
     * 保存自选基金
     */
    function saveFavorites(favorites) {
        try {
            localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
            return true;
        } catch (e) {
            console.error('保存自选失败:', e);
            return false;
        }
    }

    /**
     * 添加自选基金
     */
    function addFavorite(fund) {
        var favorites = getFavorites();
        // 检查是否已存在
        var existing = favorites.find(function (f) { return f.code === fund.code; });
        if (existing) {
            return { success: false, message: '该基金已在自选列表中' };
        }

        favorites.push({
            code: fund.code,
            name: fund.name || '',
            type: fund.type || fund.category || '',
            group: fund.group || DEFAULT_GROUP,
            addTime: Date.now()
        });
        saveFavorites(favorites);
        return { success: true, message: '添加自选成功' };
    }

    /**
     * 删除自选基金
     */
    function removeFavorite(code) {
        var favorites = getFavorites();
        var filtered = favorites.filter(function (f) { return f.code !== code; });
        saveFavorites(filtered);
        return { success: true, message: '已移除自选' };
    }

    /**
     * 检查是否已自选
     */
    function isFavorite(code) {
        var favorites = getFavorites();
        return favorites.some(function (f) { return f.code === code; });
    }

    /**
     * 移动到分组
     */
    function moveToGroup(code, group) {
        var favorites = getFavorites();
        var fund = favorites.find(function (f) { return f.code === code; });
        if (fund) {
            fund.group = group || DEFAULT_GROUP;
            saveFavorites(favorites);
            return { success: true, message: '已移动到分组: ' + group };
        }
        return { success: false, message: '未找到该基金' };
    }

    // ========== 分组管理 ==========

    /**
     * 获取所有分组
     */
    function getGroups() {
        try {
            var data = localStorage.getItem(GROUPS_KEY);
            var groups = data ? JSON.parse(data) : [];
            // 确保默认分组存在
            if (groups.indexOf(DEFAULT_GROUP) === -1) {
                groups.unshift(DEFAULT_GROUP);
            }
            return groups;
        } catch (e) {
            return [DEFAULT_GROUP];
        }
    }

    /**
     * 添加分组
     */
    function addGroup(name) {
        if (!name || !name.trim()) return { success: false, message: '分组名不能为空' };
        var groups = getGroups();
        if (groups.indexOf(name.trim()) !== -1) {
            return { success: false, message: '该分组已存在' };
        }
        groups.push(name.trim());
        localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
        return { success: true, message: '分组创建成功' };
    }

    /**
     * 删除分组(基金移回全部)
     */
    function removeGroup(name) {
        if (name === DEFAULT_GROUP) return { success: false, message: '默认分组不可删除' };
        var groups = getGroups();
        groups = groups.filter(function (g) { return g !== name; });
        localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));

        // 将该分组下的基金移到默认分组
        var favorites = getFavorites();
        favorites.forEach(function (f) {
            if (f.group === name) f.group = DEFAULT_GROUP;
        });
        saveFavorites(favorites);
        return { success: true, message: '分组已删除' };
    }

    // ========== 搜索历史 ==========

    /**
     * 获取搜索历史
     */
    function getSearchHistory() {
        try {
            var data = localStorage.getItem(HISTORY_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    }

    /**
     * 添加搜索历史
     */
    function addSearchHistory(keyword) {
        if (!keyword || !keyword.trim()) return;
        var history = getSearchHistory();
        // 去重
        history = history.filter(function (h) { return h !== keyword.trim(); });
        history.unshift(keyword.trim());
        // 只保留最近20条
        if (history.length > 20) history = history.slice(0, 20);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }

    /**
     * 清空搜索历史
     */
    function clearSearchHistory() {
        localStorage.removeItem(HISTORY_KEY);
    }

    /**
     * 删除单条搜索历史
     */
    function removeSearchHistory(keyword) {
        var history = getSearchHistory();
        history = history.filter(function (h) { return h !== keyword; });
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }

    // ========== 持仓管理 ==========

    /**
     * 获取所有持仓列表
     */
    function getHoldings() {
        try {
            var data = localStorage.getItem(HOLDINGS_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('获取持仓失败:', e);
            return [];
        }
    }

    /**
     * 保存持仓列表
     */
    function saveHoldings(holdings) {
        try {
            localStorage.setItem(HOLDINGS_KEY, JSON.stringify(holdings));
            return true;
        } catch (e) {
            console.error('保存持仓失败:', e);
            return false;
        }
    }

    /**
     * 添加持仓
     * @param {Object} holding - {code, name, type, amount, buyPrice, buyDate}
     *   amount: 持有金额（用户投入的总金额）
     *   buyPrice: 买入时的单位净值（系统自动获取）
     *   shares: 内部计算 = amount / buyPrice
     * @returns {Object} {success: boolean, message: string}
     */
    function addHolding(holding) {
        try {
            if (!holding) {
                return { success: false, message: '持仓数据不能为空' };
            }
            // 检查必填字段
            if (!holding.code) {
                return { success: false, message: '基金代码不能为空' };
            }
            if (holding.amount === undefined || holding.amount === null || holding.amount === '' || isNaN(Number(holding.amount)) || Number(holding.amount) <= 0) {
                return { success: false, message: '持有金额必须为正数' };
            }
            var buyPrice = Number(holding.buyPrice) || 0;
            if (buyPrice <= 0) {
                return { success: false, message: '无法获取基金净值，请稍后重试' };
            }

            var amount = Number(holding.amount);
            var shares = amount / buyPrice;  // 内部计算份额

            var holdings = getHoldings();
            var record = {
                code: holding.code,
                name: holding.name || '',
                type: holding.type || holding.category || '',
                amount: amount,
                buyPrice: buyPrice,
                shares: shares,
                buyDate: holding.buyDate || '',
                addTime: Date.now()
            };
            holdings.push(record);
            var saved = saveHoldings(holdings);
            if (!saved) {
                return { success: false, message: '保存持仓失败' };
            }
            return { success: true, message: '添加持仓成功' };
        } catch (e) {
            console.error('添加持仓失败:', e);
            return { success: false, message: '添加持仓失败: ' + e.message };
        }
    }

    /**
     * 删除指定持仓（通过addTime作为唯一ID）
     * @param {number} id - 持仓的addTime
     * @returns {Object} {success: boolean, message: string}
     */
    function removeHolding(id) {
        try {
            var holdings = getHoldings();
            var filtered = holdings.filter(function (h) { return h.addTime !== id; });
            if (filtered.length === holdings.length) {
                return { success: false, message: '未找到该持仓记录' };
            }
            var saved = saveHoldings(filtered);
            if (!saved) {
                return { success: false, message: '删除持仓失败' };
            }
            return { success: true, message: '已删除持仓' };
        } catch (e) {
            console.error('删除持仓失败:', e);
            return { success: false, message: '删除持仓失败: ' + e.message };
        }
    }

    /**
     * 更新持仓信息
     * @param {number} id - 持仓的addTime
     * @param {Object} data - 要更新的字段
     * @returns {Object} {success: boolean, message: string}
     */
    function updateHolding(id, data) {
        try {
            if (!data) {
                return { success: false, message: '更新数据不能为空' };
            }
            var holdings = getHoldings();
            var target = holdings.find(function (h) { return h.addTime === id; });
            if (!target) {
                return { success: false, message: '未找到该持仓记录' };
            }

            // 字段更新（带校验）
            if (data.code !== undefined) {
                if (!data.code) return { success: false, message: '基金代码不能为空' };
                target.code = data.code;
            }
            if (data.name !== undefined) {
                target.name = data.name || '';
            }
            if (data.type !== undefined) {
                target.type = data.type || data.category || '';
            }
            if (data.amount !== undefined) {
                if (data.amount === '' || data.amount === null || isNaN(Number(data.amount)) || Number(data.amount) <= 0) {
                    return { success: false, message: '持有金额必须为正数' };
                }
                target.amount = Number(data.amount);
                // 重新计算份额
                if (target.buyPrice && target.buyPrice > 0) {
                    target.shares = target.amount / target.buyPrice;
                }
            }
            if (data.buyPrice !== undefined) {
                if (data.buyPrice === '' || data.buyPrice === null || isNaN(Number(data.buyPrice)) || Number(data.buyPrice) <= 0) {
                    return { success: false, message: '买入净值必须为正数' };
                }
                target.buyPrice = Number(data.buyPrice);
                // 重新计算份额
                if (target.amount && target.amount > 0) {
                    target.shares = target.amount / target.buyPrice;
                }
            }
            if (data.buyDate !== undefined) {
                target.buyDate = data.buyDate || '';
            }

            var saved = saveHoldings(holdings);
            if (!saved) {
                return { success: false, message: '更新持仓失败' };
            }
            return { success: true, message: '更新持仓成功' };
        } catch (e) {
            console.error('更新持仓失败:', e);
            return { success: false, message: '更新持仓失败: ' + e.message };
        }
    }

    /**
     * 获取某基金的所有持仓记录（可能多条）
     * @param {string} code - 基金代码
     * @returns {Array} 持仓记录数组
     */
    function getHoldingByCode(code) {
        try {
            var holdings = getHoldings();
            return holdings.filter(function (h) { return h.code === code; });
        } catch (e) {
            console.error('查询持仓失败:', e);
            return [];
        }
    }

    /**
     * 检查某基金是否已有持仓
     * @param {string} code - 基金代码
     * @returns {boolean}
     */
    function isHolding(code) {
        var holdings = getHoldings();
        return holdings.some(function (h) { return h.code === code; });
    }

    // ========== 持仓计算辅助函数 ==========

    /**
     * 计算单条持仓的盈亏
     * @param {Object} holding - 持仓记录
     * @param {number} currentNav - 当前单位净值
     * @returns {Object} {cost, currentValue, profit, profitRate}
     */
    function calcHoldingProfit(holding, currentNav) {
        try {
            if (!holding) {
                return { cost: 0, currentValue: 0, profit: 0, profitRate: 0 };
            }
            var buyPrice = Number(holding.buyPrice) || 0;
            var shares = Number(holding.shares) || 0;
            var nav = Number(currentNav) || 0;

            // 优先使用 amount（新格式），否则用 buyPrice * shares（旧格式兼容）
            var cost = (holding.amount !== undefined && holding.amount !== null) ? Number(holding.amount) : (buyPrice * shares);
            var currentValue = nav * shares;        // 当前市值
            var profit = currentValue - cost;       // 盈亏额
            var profitRate = cost > 0 ? (profit / cost) : 0;  // 盈亏率

            return {
                cost: cost,
                currentValue: currentValue,
                profit: profit,
                profitRate: profitRate
            };
        } catch (e) {
            console.error('计算持仓盈亏失败:', e);
            return { cost: 0, currentValue: 0, profit: 0, profitRate: 0 };
        }
    }

    /**
     * 计算所有持仓的总盈亏
     * @param {Array} holdings - 持仓列表
     * @param {Object} navMap - {code: 当前净值} 的映射
     * @returns {Object} {totalCost, totalValue, totalProfit, totalProfitRate, count}
     */
    function calcTotalProfit(holdings, navMap) {
        try {
            holdings = holdings || [];
            navMap = navMap || {};

            var totalCost = 0;
            var totalValue = 0;
            var count = 0;

            holdings.forEach(function (h) {
                var nav = navMap[h.code];
                if (nav === undefined || nav === null) {
                    return; // 缺少净值的持仓不计入总盈亏
                }
                var result = calcHoldingProfit(h, nav);
                totalCost += result.cost;
                totalValue += result.currentValue;
                count++;
            });

            var totalProfit = totalValue - totalCost;
            var totalProfitRate = totalCost > 0 ? (totalProfit / totalCost) : 0;

            return {
                totalCost: totalCost,
                totalValue: totalValue,
                totalProfit: totalProfit,
                totalProfitRate: totalProfitRate,
                count: count
            };
        } catch (e) {
            console.error('计算总盈亏失败:', e);
            return { totalCost: 0, totalValue: 0, totalProfit: 0, totalProfitRate: 0, count: 0 };
        }
    }

    return {
        DEFAULT_GROUP: DEFAULT_GROUP,
        // 自选基金
        getFavorites: getFavorites,
        addFavorite: addFavorite,
        removeFavorite: removeFavorite,
        isFavorite: isFavorite,
        moveToGroup: moveToGroup,
        // 分组管理
        getGroups: getGroups,
        addGroup: addGroup,
        removeGroup: removeGroup,
        // 搜索历史
        getSearchHistory: getSearchHistory,
        addSearchHistory: addSearchHistory,
        clearSearchHistory: clearSearchHistory,
        removeSearchHistory: removeSearchHistory,
        // 持仓管理
        getHoldings: getHoldings,
        addHolding: addHolding,
        removeHolding: removeHolding,
        updateHolding: updateHolding,
        getHoldingByCode: getHoldingByCode,
        isHolding: isHolding,
        // 持仓计算辅助
        calcHoldingProfit: calcHoldingProfit,
        calcTotalProfit: calcTotalProfit
    };
})();
