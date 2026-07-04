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

    // 检查是否已登录
    function isLoggedIn() {
        try {
            var user = localStorage.getItem('fund_user');
            return !!user;
        } catch (e) {
            return false;
        }
    }

    // ========== 自选基金 ==========

    /**
     * 获取所有自选基金
     */
    function getFavorites() {
        if (!isLoggedIn()) return [];
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
        if (!isLoggedIn()) return [];
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
                group: holding.group || '',
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
     * 减仓（赎回）—— 创建卖出交易记录
     * @param {Object} data - {code, name, type, shares, price, date}
     *   shares: 赎回份额（正数）
     *   price: 赎回时的单位净值（当前净值）
     * @returns {Object} {success: boolean, message: string}
     */
    function addSellTransaction(data) {
        try {
            if (!data || !data.code) {
                return { success: false, message: '基金代码不能为空' };
            }
            var sellShares = Number(data.shares);
            if (!sellShares || sellShares <= 0) {
                return { success: false, message: '赎回份额必须为正数' };
            }
            var sellPrice = Number(data.price) || 0;
            if (sellPrice <= 0) {
                return { success: false, message: '无法获取基金净值，请稍后重试' };
            }

            // 检查持有份额是否足够
            var position = getAggregatedPosition(data.code);
            if (!position || position.currentShares < sellShares - 0.0001) {
                return { success: false, message: '赎回份额不能超过持有份额（' + (position ? position.currentShares.toFixed(4) : 0) + '份）' };
            }

            var holdings = getHoldings();
            var record = {
                code: data.code,
                name: data.name || '',
                type: data.type || data.category || '',
                opType: 'sell',
                amount: sellShares * sellPrice,
                price: sellPrice,
                shares: sellShares,
                date: data.date || '',
                group: data.group || '',
                addTime: Date.now()
            };
            holdings.push(record);
            var saved = saveHoldings(holdings);
            if (!saved) {
                return { success: false, message: '减仓失败' };
            }

            // 计算本次减仓的已实现收益
            var realized = sellShares * (sellPrice - position.costPrice);
            return {
                success: true,
                message: '减仓成功，本次收益 ' + (realized >= 0 ? '+' : '') + realized.toFixed(2) + ' 元'
            };
        } catch (e) {
            console.error('减仓失败:', e);
            return { success: false, message: '减仓失败: ' + e.message };
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
     * 删除某基金的所有交易记录（聚合视图中的"删除"操作）
     * @param {string} code - 基金代码
     * @returns {Object} {success: boolean, message: string}
     */
    function removeFundTransactions(code) {
        try {
            var holdings = getHoldings();
            var filtered = holdings.filter(function (h) { return h.code !== code; });
            if (filtered.length === holdings.length) {
                return { success: false, message: '未找到该基金记录' };
            }
            var saved = saveHoldings(filtered);
            if (!saved) {
                return { success: false, message: '删除失败' };
            }
            return { success: true, message: '已删除该基金所有记录' };
        } catch (e) {
            console.error('删除基金记录失败:', e);
            return { success: false, message: '删除失败: ' + e.message };
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

    // ========== 聚合持仓（按基金代码合并加减仓）==========

    /**
     * 获取所有基金的聚合持仓（每只基金一条，汇总所有买卖交易）
     * 兼容旧数据：无 opType 的记录视为买入
     * @returns {Array} 聚合持仓数组
     */
    function getAggregatedPositions() {
        try {
            var holdings = getHoldings();
            var grouped = {};
            holdings.forEach(function (h) {
                if (!grouped[h.code]) {
                    grouped[h.code] = {
                        code: h.code,
                        name: h.name || '',
                        type: h.type || '',
                        group: '',
                        transactions: []
                    };
                }
                grouped[h.code].transactions.push(h);
                if (!grouped[h.code].name && h.name) grouped[h.code].name = h.name;
                if (!grouped[h.code].type && h.type) grouped[h.code].type = h.type;
                if (h.group) grouped[h.code].group = h.group;
            });

            var positions = [];
            Object.keys(grouped).forEach(function (code) {
                var group = grouped[code];
                var buys = group.transactions.filter(function (t) { return !t.opType || t.opType === 'buy'; });
                var sells = group.transactions.filter(function (t) { return t.opType === 'sell'; });

                var totalBuyAmount = buys.reduce(function (s, t) { return s + Number(t.amount || 0); }, 0);
                var totalBuyShares = buys.reduce(function (s, t) { return s + Number(t.shares || 0); }, 0);
                var totalSellAmount = sells.reduce(function (s, t) { return s + Number(t.amount || 0); }, 0);
                var totalSellShares = sells.reduce(function (s, t) { return s + Number(t.shares || 0); }, 0);

                var currentShares = totalBuyShares - totalSellShares;
                var costPrice = totalBuyShares > 0 ? totalBuyAmount / totalBuyShares : 0;
                var currentCost = costPrice * currentShares;  // 当前持仓成本
                var realizedProfit = totalSellShares > 0
                    ? totalSellAmount - (totalSellShares * costPrice)
                    : 0;

                positions.push({
                    code: group.code,
                    name: group.name,
                    type: group.type,
                    group: group.group,
                    totalBuyAmount: totalBuyAmount,
                    totalBuyShares: totalBuyShares,
                    totalSellAmount: totalSellAmount,
                    totalSellShares: totalSellShares,
                    currentShares: currentShares,
                    costPrice: costPrice,
                    currentCost: currentCost,
                    realizedProfit: realizedProfit,
                    transactionCount: group.transactions.length,
                    isCleared: currentShares <= 0.0001
                });
            });

            return positions;
        } catch (e) {
            console.error('获取聚合持仓失败:', e);
            return [];
        }
    }

    /**
     * 获取单只基金的聚合持仓
     */
    function getAggregatedPosition(code) {
        var positions = getAggregatedPositions();
        return positions.find(function (p) { return p.code === code; }) || null;
    }

    /**
     * 获取某基金的所有交易记录（按时间倒序）
     */
    function getTransactionsByCode(code) {
        try {
            var holdings = getHoldings();
            return holdings.filter(function (h) { return h.code === code; })
                .sort(function (a, b) { return (b.addTime || 0) - (a.addTime || 0); });
        } catch (e) {
            console.error('查询交易记录失败:', e);
            return [];
        }
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

    // ========== 聚合持仓盈亏计算 ==========

    /**
     * 计算单只基金聚合持仓的盈亏
     * 持仓收益 = 日涨跌幅 × 当前持仓市值（当日收益）
     * 累计收益 = 当前持仓收益 + 已实现收益
     * @param {Object} position - getAggregatedPositions() 返回的持仓对象
     * @param {number} currentNav - 当前单位净值
     * @param {number} dailyChangeRate - 日涨跌幅（百分比，如 1.52 表示 1.52%）
     * @returns {Object} {cost, currentValue, holdingProfit, holdingProfitRate, realizedProfit, cumulativeProfit}
     */
    function calcPositionProfit(position, currentNav, dailyChangeRate) {
        try {
            if (!position) {
                return { cost: 0, currentValue: 0, holdingProfit: 0, holdingProfitRate: 0, realizedProfit: 0, cumulativeProfit: 0, dailyProfit: 0, dailyProfitRate: 0 };
            }
            var nav = Number(currentNav) || 0;
            var changeRate = Number(dailyChangeRate) || 0;  // 百分比，如 1.52
            var changeDecimal = changeRate / 100;            // 小数，如 0.0152

            var currentShares = position.currentShares || 0;
            var cost = position.currentCost || 0;            // = costPrice * currentShares
            var currentValue = nav * currentShares;          // 当前市值

            // 持仓盈亏(浮动盈亏) = 当前市值 - 持仓成本
            var holdingProfit = currentValue - cost;
            // 持仓收益率 = 持仓盈亏 / 持仓成本
            var holdingProfitRate = cost > 0 ? (holdingProfit / cost) : 0;
            // 累计盈亏 = 浮动盈亏 + 已实现收益(卖出盈亏)
            var cumulativeProfit = holdingProfit + (position.realizedProfit || 0);
            // 当日收益 = 日涨跌幅 × 当前市值(仅参考)
            var dailyProfit = changeDecimal * currentValue;
            var dailyProfitRate = changeDecimal;

            return {
                cost: cost,
                currentValue: currentValue,
                holdingProfit: holdingProfit,
                holdingProfitRate: holdingProfitRate,
                realizedProfit: position.realizedProfit || 0,
                cumulativeProfit: cumulativeProfit,
                dailyProfit: dailyProfit,
                dailyProfitRate: dailyProfitRate
            };
        } catch (e) {
            console.error('计算聚合持仓盈亏失败:', e);
            return { cost: 0, currentValue: 0, holdingProfit: 0, holdingProfitRate: 0, realizedProfit: 0, cumulativeProfit: 0, dailyProfit: 0, dailyProfitRate: 0 };
        }
    }

    /**
     * 计算所有聚合持仓的总盈亏
     * @param {Array} positions - getAggregatedPositions() 返回的数组
     * @param {Object} navMap - {code: 当前净值}
     * @param {Object} changeRateMap - {code: 日涨跌幅(百分比)}
     * @returns {Object} {totalValue, totalCost, totalHoldingProfit, totalProfitRate, totalRealizedProfit, totalCumulativeProfit, count}
     */
    function calcTotalAggregatedProfit(positions, navMap, changeRateMap) {
        try {
            positions = positions || [];
            navMap = navMap || {};
            changeRateMap = changeRateMap || {};

            var totalValue = 0;
            var totalCost = 0;
            var totalHoldingProfit = 0;
            var totalRealizedProfit = 0;
            var totalDailyProfit = 0;
            var count = 0;

            positions.forEach(function (p) {
                var changeRate = changeRateMap[p.code] || 0;
                // 已清仓持仓无净值但仍有已实现收益,不应跳过
                var nav = navMap[p.code];
                if (nav === undefined || nav === null) {
                    // 估值缺失:已清仓则用0,未清仓则用成本价
                    nav = (p.currentShares || 0) <= 0.0001 ? 0 : (p.costPrice || 0);
                }
                var calc = calcPositionProfit(p, nav, changeRate);
                totalValue += calc.currentValue;
                totalCost += calc.cost;
                totalHoldingProfit += calc.holdingProfit;
                totalRealizedProfit += calc.realizedProfit;
                totalDailyProfit += calc.dailyProfit;
                count++;
            });

            // 持仓收益率 = 持仓盈亏 / 持仓成本
            var totalProfitRate = totalCost > 0 ? (totalHoldingProfit / totalCost) : 0;
            // 累计盈亏 = 浮动盈亏 + 已实现收益
            var totalCumulativeProfit = totalHoldingProfit + totalRealizedProfit;

            return {
                totalValue: totalValue,
                totalCost: totalCost,
                totalHoldingProfit: totalHoldingProfit,
                totalProfitRate: totalProfitRate,
                totalRealizedProfit: totalRealizedProfit,
                totalCumulativeProfit: totalCumulativeProfit,
                totalDailyProfit: totalDailyProfit,
                count: count
            };
        } catch (e) {
            console.error('计算总聚合盈亏失败:', e);
            return { totalValue: 0, totalCost: 0, totalHoldingProfit: 0, totalProfitRate: 0, totalRealizedProfit: 0, totalCumulativeProfit: 0, totalDailyProfit: 0, count: 0 };
        }
    }

    // ========== 持仓分组管理 ==========

    /**
     * 获取所有持仓分组（从持仓记录中提取唯一分组）
     */
    function getPortfolioGroups() {
        try {
            var holdings = getHoldings();
            var groups = {};
            holdings.forEach(function (h) {
                if (h.group && !groups[h.group]) {
                    groups[h.group] = true;
                }
            });
            return Object.keys(groups);
        } catch (e) {
            return [];
        }
    }

    /**
     * 设置基金持仓的分组
     */
    function setHoldingGroup(code, group) {
        try {
            var holdings = getHoldings();
            var updated = false;
            holdings.forEach(function (h) {
                if (h.code === code) {
                    h.group = group || '';
                    updated = true;
                }
            });
            if (!updated) {
                return { success: false, message: '未找到该基金持仓' };
            }
            var saved = saveHoldings(holdings);
            return saved
                ? { success: true, message: '分组设置成功' }
                : { success: false, message: '保存失败' };
        } catch (e) {
            return { success: false, message: '设置分组失败: ' + e.message };
        }
    }

    /**
     * 批量设置分组
     */
    function batchSetGroup(codes, group) {
        try {
            var holdings = getHoldings();
            var count = 0;
            holdings.forEach(function (h) {
                if (codes.indexOf(h.code) !== -1) {
                    h.group = group || '';
                    count++;
                }
            });
            var saved = saveHoldings(holdings);
            return saved
                ? { success: true, message: '已设置 ' + count + ' 条记录的分组', count: count }
                : { success: false, message: '保存失败' };
        } catch (e) {
            return { success: false, message: '批量设置分组失败: ' + e.message };
        }
    }

    /**
     * 批量加仓
     * @param {Array} items - [{code, name, type, amount, buyPrice, buyDate}]
     */
    function batchAddPosition(items) {
        try {
            var successCount = 0;
            var failCount = 0;
            var holdings = getHoldings();
            items.forEach(function (item) {
                if (!item.code || !item.amount || item.amount <= 0 || !item.buyPrice || item.buyPrice <= 0) {
                    failCount++;
                    return;
                }
                var amount = Number(item.amount);
                var buyPrice = Number(item.buyPrice);
                var shares = amount / buyPrice;
                holdings.push({
                    code: item.code,
                    name: item.name || '',
                    type: item.type || '',
                    amount: amount,
                    buyPrice: buyPrice,
                    shares: shares,
                    buyDate: item.buyDate || '',
                    group: item.group || '',
                    addTime: Date.now() + successCount
                });
                successCount++;
            });
            var saved = saveHoldings(holdings);
            if (!saved) {
                return { success: false, message: '保存失败', successCount: 0, failCount: items.length };
            }
            return {
                success: true,
                message: '批量加仓完成，成功 ' + successCount + ' 只' + (failCount > 0 ? '，失败 ' + failCount + ' 只' : ''),
                successCount: successCount,
                failCount: failCount
            };
        } catch (e) {
            return { success: false, message: '批量加仓失败: ' + e.message, successCount: 0, failCount: items.length };
        }
    }

    /**
     * 批量减仓（按百分比减仓）
     * @param {Array} items - [{code, name, type, percent, price, date}]
     */
    function batchReducePosition(items) {
        try {
            var successCount = 0;
            var failCount = 0;
            var holdings = getHoldings();
            var failMessages = [];
            var positionSnapshots = {};
            var allPositions = getAggregatedPositions();
            allPositions.forEach(function (p) {
                positionSnapshots[p.code] = p;
            });

            items.forEach(function (item) {
                if (!item.code) { failCount++; return; }
                var position = positionSnapshots[item.code];
                if (!position || position.currentShares <= 0.0001) {
                    failCount++;
                    failMessages.push((item.name || item.code) + '：无持仓');
                    return;
                }
                var percent = Number(item.percent) || 0;
                if (percent <= 0 || percent > 100) {
                    failCount++;
                    failMessages.push((item.name || item.code) + '：比例无效');
                    return;
                }
                var sellShares = position.currentShares * (percent / 100);
                var sellPrice = Number(item.price) || 0;
                if (sellPrice <= 0) {
                    failCount++;
                    failMessages.push((item.name || item.code) + '：净值无效');
                    return;
                }
                holdings.push({
                    code: item.code,
                    name: item.name || position.name || '',
                    type: item.type || position.type || '',
                    opType: 'sell',
                    amount: sellShares * sellPrice,
                    price: sellPrice,
                    shares: sellShares,
                    date: item.date || '',
                    group: position.group || '',
                    addTime: Date.now() + successCount
                });
                successCount++;
            });

            var saved = saveHoldings(holdings);
            if (!saved) {
                return { success: false, message: '保存失败', successCount: 0, failCount: items.length };
            }
            var msg = '批量减仓完成，成功 ' + successCount + ' 只';
            if (failCount > 0) {
                msg += '，失败 ' + failCount + ' 只';
                if (failMessages.length > 0) {
                    msg += '（' + failMessages.join('；') + '）';
                }
            }
            return { success: true, message: msg, successCount: successCount, failCount: failCount };
        } catch (e) {
            return { success: false, message: '批量减仓失败: ' + e.message, successCount: 0, failCount: items.length };
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
        addSellTransaction: addSellTransaction,
        removeHolding: removeHolding,
        removeFundTransactions: removeFundTransactions,
        updateHolding: updateHolding,
        getHoldingByCode: getHoldingByCode,
        isHolding: isHolding,
        // 聚合持仓
        getAggregatedPositions: getAggregatedPositions,
        getAggregatedPosition: getAggregatedPosition,
        getTransactionsByCode: getTransactionsByCode,
        // 持仓计算辅助
        calcHoldingProfit: calcHoldingProfit,
        calcTotalProfit: calcTotalProfit,
        calcPositionProfit: calcPositionProfit,
        calcTotalAggregatedProfit: calcTotalAggregatedProfit,
        // 持仓分组管理
        getPortfolioGroups: getPortfolioGroups,
        setHoldingGroup: setHoldingGroup,
        batchSetGroup: batchSetGroup,
        batchAddPosition: batchAddPosition,
        batchReducePosition: batchReducePosition
    };
})();
