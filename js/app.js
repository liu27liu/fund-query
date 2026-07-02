/**
 * 基金净值查询 - 主应用逻辑
 * 包含路由、首页、搜索、自选、基金详情等所有视图
 */
(function () {
    'use strict';

    var app = document.getElementById('app');
    var searchInput = document.getElementById('globalSearch');
    var searchBtn = document.getElementById('searchBtn');
    var searchSuggest = document.getElementById('searchSuggest');
    var detailModal = document.getElementById('detailModal');
    var detailContent = document.getElementById('detailContent');
    var modalClose = document.getElementById('modalClose');
    var toastContainer = document.getElementById('toastContainer');
    var mobileMenuBtn = document.getElementById('mobileMenuBtn');
    var loginBtn = document.getElementById('loginBtn');
    var loginModal = document.getElementById('loginModal');
    var loginFormContent = document.getElementById('loginFormContent');
    var loginModalClose = document.getElementById('loginModalClose');

    var currentChart = null;        // ECharts实例
    var searchTimer = null;          // 搜索防抖定时器
    var realtimeTimer = null;        // 实时更新定时器
    var currentDetailCode = null;    // 当前查看的基金代码
    var portfolioTimer = null;       // 持仓页自动刷新定时器
    var portfolioRefreshCountdown = null; // 倒计时定时器

    // ========== Toast 消息提示 ==========
    function showToast(message, type = 'default') {
        var toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.textContent = message;
        toastContainer.appendChild(toast);
        setTimeout(function () {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(40px)';
            toast.style.transition = 'all 0.3s';
            setTimeout(function () { toast.remove(); }, 300);
        }, 2500);
    }

    // ========== 路由 ==========
    function router() {
        var hash = location.hash.slice(1) || '/';
        var parts = hash.split('?');
        var path = parts[0];
        var query = parts[1] || '';

        // 离开持仓页时清除自动刷新
        if (path !== '/portfolio') {
            stopPortfolioAutoRefresh();
        }

        // 更新导航高亮
        document.querySelectorAll('.nav-link').forEach(function (link) {
            link.classList.toggle('active', link.dataset.route === path);
        });

        // 关闭搜索建议
        searchSuggest.classList.remove('active');

        // 路由分发
        if (path === '/' || path === '') {
            renderHome();
        } else if (path === '/search') {
            var keyword = getQueryParam(query, 'q');
            renderSearch(keyword);
        } else if (path === '/portfolio') {
            renderPortfolio();
        } else if (path === '/favorites') {
            renderFavorites();
        } else if (path === '/fund') {
            var code = getQueryParam(query, 'code');
            if (code) openDetail(code);
        } else {
            renderHome();
        }
    }

    function getQueryParam(query, key) {
        var params = query.split('&');
        for (var i = 0; i < params.length; i++) {
            var pair = params[i].split('=');
            if (pair[0] === key) return decodeURIComponent(pair[1] || '');
        }
        return '';
    }

    function navigate(path) {
        location.hash = path;
    }

    // ========== 首页 ==========
    function renderHome() {
        app.innerHTML = `
            <div class="home-hero">
                <h1>基金净值通 · 实时估值查询平台</h1>
                <p>覆盖全市场公募基金 · 盘中实时估值 · 历史净值走势 · 自选基金管理</p>
                <div class="hero-stats">
                    <div class="hero-stat">
                        <div class="num">10000+</div>
                        <div class="label">覆盖基金</div>
                    </div>
                    <div class="hero-stat">
                        <div class="num">3s</div>
                        <div class="label">估值更新</div>
                    </div>
                    <div class="hero-stat">
                        <div class="num">24h</div>
                        <div class="label">数据采集</div>
                    </div>
                    <div class="hero-stat">
                        <div class="num">0</div>
                        <div class="label">使用成本</div>
                    </div>
                </div>
            </div>

            <div id="portfolioOverview"></div>

            <div class="section-title">
                <span class="pulse-dot"></span>
                热门基金实时估值
            </div>
            <div class="fund-grid" id="hotFundGrid">
                <div class="fund-card skeleton" style="height: 160px;"></div>
                <div class="fund-card skeleton" style="height: 160px;"></div>
                <div class="fund-card skeleton" style="height: 160px;"></div>
                <div class="fund-card skeleton" style="height: 160px;"></div>
            </div>

            <div class="section-title">
                <span>🔥</span>
                热门搜索
            </div>
            <div class="hot-search-list" id="hotKeywordList"></div>

            <div class="section-title">
                <span>📊</span>
                涨幅榜 TOP 10
            </div>
            <div class="fund-table-wrap" id="rankingTable">
                <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                    <div class="loader" style="margin: 0 auto 12px;"></div>
                    正在加载涨幅排行...
                </div>
            </div>
        `;

        // 渲染热门关键词
        var hotKeywords = FundAPI.getHotKeywords();
        var keywordHtml = hotKeywords.map(function (kw) {
            return '<span class="hot-search-item" data-keyword="' + kw + '">' + kw + '</span>';
        }).join('');
        document.getElementById('hotKeywordList').innerHTML = keywordHtml;

        // 点击热门搜索
        document.querySelectorAll('.hot-search-item').forEach(function (el) {
            el.addEventListener('click', function () {
                var kw = this.dataset.keyword;
                searchInput.value = kw;
                navigate('/search?q=' + encodeURIComponent(kw));
            });
        });

        // 加载热门基金实时估值
        loadHotFunds();
        // 加载涨幅榜
        loadRanking();
        // 加载持仓概览
        loadPortfolioOverview();
    }

    // ========== 持仓概览(首页) ==========
    async function loadPortfolioOverview() {
        var container = document.getElementById('portfolioOverview');
        if (!container) return;

        var positions = Store.getAggregatedPositions();
        if (positions.length === 0) return;

        // 获取所有持仓基金的实时估值
        var codes = positions.map(function (p) { return p.code; });
        var estimates = await FundAPI.batchRealtimeEstimate(codes);

        // 构建净值映射 (优先用估值gsz,没有就用dwjz)
        var navMap = {};
        positions.forEach(function (p) {
            var est = estimates.find(function (e) { return e.fundcode === p.code; });
            if (est) {
                navMap[p.code] = est.gsz || est.dwjz || p.costPrice;
            } else {
                navMap[p.code] = p.costPrice;
            }
        });

        var totals = Store.calcTotalAggregatedProfit(positions, navMap);
        var profitClass = totals.totalHoldingProfit >= 0 ? 'profit-positive' : 'profit-negative';
        var profitSign = totals.totalHoldingProfit >= 0 ? '+' : '';

        container.innerHTML = `
            <div class="portfolio-summary" style="margin-bottom: 24px;">
                <div class="summary-header">
                    <span class="summary-title">📊 我的持仓</span>
                    <a href="#/portfolio" class="summary-link">查看详情 →</a>
                </div>
                <div class="summary-grid">
                    <div class="summary-item">
                        <div class="summary-label">持仓市值</div>
                        <div class="summary-value">¥${formatMoney(totals.totalValue)}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">持仓成本</div>
                        <div class="summary-value">¥${formatMoney(totals.totalCost)}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">持仓收益</div>
                        <div class="summary-value ${profitClass}">${profitSign}${formatMoney(totals.totalHoldingProfit)}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">收益率</div>
                        <div class="summary-value ${profitClass}">${profitSign}${(totals.totalProfitRate * 100).toFixed(2)}%</div>
                    </div>
                </div>
            </div>
        `;
    }

    function formatMoney(num) {
        if (!num || isNaN(num)) return '0.00';
        return parseFloat(num).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    async function loadHotFunds(containerId) {
        var hotFunds = FundAPI.getHotFunds();
        var grid = document.getElementById(containerId || 'hotFundGrid');
        if (!grid) return;

        // 先渲染骨架
        grid.innerHTML = hotFunds.slice(0, 8).map(function () {
            return '<div class="fund-card skeleton" style="height: 160px;"></div>';
        }).join('');

        // 批量获取实时估值
        var codes = hotFunds.slice(0, 8).map(function (f) { return f.code; });
        var estimates = await FundAPI.batchRealtimeEstimate(codes);

        // 合并基金信息
        var fundData = hotFunds.slice(0, 8).map(function (f) {
            var est = estimates.find(function (e) { return e.fundcode === f.code; });
            return {
                code: f.code,
                name: (est && est.name) || f.name,
                type: f.type,
                dwjz: est ? est.dwjz : 0,
                gsz: est ? est.gsz : 0,
                gszzl: est ? est.gszzl : 0,
                gztime: est ? est.gztime : ''
            };
        });

        grid.innerHTML = fundData.map(function (f) {
            var changeClass = FundAPI.getChangeClass(f.gszzl);
            var isEstimate = f.gsz && f.gsz !== f.dwjz;
            return `
                <div class="fund-card" data-code="${f.code}">
                    ${isEstimate ? '<span class="fund-card-badge">盘中估值</span>' : ''}
                    <div class="fund-card-header">
                        <div>
                            <div class="fund-card-name" title="${f.name}">${f.name}</div>
                            <div class="fund-card-code">${f.code}</div>
                        </div>
                        <span class="fund-card-type">${f.type}</span>
                    </div>
                    <div class="fund-card-value">
                        <span class="fund-card-dwjz ${changeClass}">${FundAPI.formatNum(f.gsz || f.dwjz)}</span>
                        <span class="fund-card-change ${changeClass}">${FundAPI.formatChange(f.gszzl)}</span>
                    </div>
                    <div class="fund-card-footer">
                        <span>${isEstimate ? '估值: ' + FundAPI.formatDate(f.gztime, 'MM-DD HH:mm') : '净值: ' + FundAPI.formatDate(f.gztime, 'MM-DD')}</span>
                        <span>点击查看详情 →</span>
                    </div>
                </div>
            `;
        }).join('');

        // 绑定点击事件
        grid.querySelectorAll('.fund-card').forEach(function (card) {
            card.addEventListener('click', function () {
                openDetail(this.dataset.code);
            });
        });
    }

    async function loadRanking() {
        var container = document.getElementById('rankingTable');
        if (!container) return;

        var ranking = await FundAPI.getFundRanking('RZDF', 10);

        if (ranking.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">📊</div>
                    <h3>暂无排行数据</h3>
                    <p>数据接口可能暂时不可用,请稍后重试</p>
                </div>
            `;
            return;
        }

        // 获取实时估值补充
        var codes = ranking.map(function (f) { return f.code; });
        var estimates = await FundAPI.batchRealtimeEstimate(codes);

        container.innerHTML = `
            <table class="fund-table">
                <thead>
                    <tr>
                        <th>基金名称</th>
                        <th class="text-right">最新净值</th>
                        <th class="text-right">估值</th>
                        <th class="text-right">日涨跌幅</th>
                        <th class="text-right">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${ranking.map(function (f, i) {
                        var est = estimates.find(function (e) { return e.fundcode === f.code; });
                        var change = est ? est.gszzl : f.change;
                        var changeClass = FundAPI.getChangeClass(change);
                        var isFav = Store.isFavorite(f.code);
                        return `
                            <tr data-code="${f.code}">
                                <td class="col-name">
                                    <div class="fund-name-cell">
                                        <span class="name">${(i + 1)}. ${f.name}</span>
                                        <span class="code">${f.code} · ${f.type}</span>
                                    </div>
                                </td>
                                <td class="num-cell">${FundAPI.formatNum(est ? est.dwjz : f.netValue)}</td>
                                <td class="num-cell">${est ? FundAPI.formatNum(est.gsz) : '--'}</td>
                                <td class="num-cell">
                                    <span class="change-badge ${changeClass === 'up' ? 'bg-up' : changeClass === 'down' ? 'bg-down' : 'bg-flat'}">
                                        ${FundAPI.formatChange(change)}
                                    </span>
                                </td>
                                <td>
                                    <button class="action-btn ${isFav ? '' : 'add-fav-mini'}" data-action="${isFav ? 'remove' : 'add'}" data-code="${f.code}" data-name="${f.name}" data-type="${f.type}">
                                        ${isFav ? '移除自选' : '+ 自选'}
                                    </button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;

        // 绑定事件
        container.querySelectorAll('tr[data-code]').forEach(function (tr) {
            tr.addEventListener('click', function (e) {
                if (e.target.classList.contains('action-btn')) return;
                openDetail(this.dataset.code);
            });
        });

        container.querySelectorAll('.action-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                handleFavToggle(this);
            });
        });
    }

    // ========== 搜索页 ==========
    function renderSearch(keyword) {
        if (!keyword) {
            // 无关键词,显示搜索引导页
            var history = Store.getSearchHistory();
            var hotKeywords = FundAPI.getHotKeywords();

            app.innerHTML = `
                <div class="search-results-header">
                    <h2>基金搜索</h2>
                    <p>输入基金代码、名称或拼音首字母进行搜索</p>
                </div>

                ${history.length > 0 ? `
                    <div class="section-title">
                        <span>🕐</span> 搜索历史
                        <span class="more" id="clearHistoryBtn">清空</span>
                    </div>
                    <div class="hot-search-list">
                        ${history.map(function (h) {
                            return '<span class="hot-search-item" data-keyword="' + h + '">' + h + ' <small style="color:var(--text-tertiary)">×</small></span>';
                        }).join('')}
                    </div>
                ` : ''}

                <div class="section-title">
                    <span>🔥</span> 热门搜索
                </div>
                <div class="hot-search-list">
                    ${hotKeywords.map(function (kw) {
                        return '<span class="hot-search-item" data-keyword="' + kw + '">' + kw + '</span>';
                    }).join('')}
                </div>

                <div class="section-title">
                    <span>⭐</span> 推荐基金
                </div>
                <div class="fund-grid" id="recommendGrid">
                    <div class="fund-card skeleton" style="height: 160px;"></div>
                    <div class="fund-card skeleton" style="height: 160px;"></div>
                    <div class="fund-card skeleton" style="height: 160px;"></div>
                    <div class="fund-card skeleton" style="height: 160px;"></div>
                </div>
            `;

            // 绑定热门搜索和历史
            document.querySelectorAll('.hot-search-item').forEach(function (el) {
                el.addEventListener('click', function () {
                    var kw = this.dataset.keyword;
                    searchInput.value = kw;
                    navigate('/search?q=' + encodeURIComponent(kw));
                });
            });

            // 清空历史
            var clearBtn = document.getElementById('clearHistoryBtn');
            if (clearBtn) {
                clearBtn.addEventListener('click', function () {
                    Store.clearSearchHistory();
                    renderSearch('');
                    showToast('搜索历史已清空', 'success');
                });
            }

            // 加载推荐基金
            loadHotFunds('recommendGrid');
            return;
        }

        // 有关键词,执行搜索
        Store.addSearchHistory(keyword);
        app.innerHTML = `
            <div class="search-results-header">
                <h2>搜索结果: "${keyword}"</h2>
                <p>正在搜索中...</p>
            </div>
            <div class="search-filter-bar">
                <span class="filter-chip active" data-filter="all">全部</span>
                <span class="filter-chip" data-filter="股票型">股票型</span>
                <span class="filter-chip" data-filter="混合型">混合型</span>
                <span class="filter-chip" data-filter="债券型">债券型</span>
                <span class="filter-chip" data-filter="指数型">指数型</span>
                <span class="filter-chip" data-filter="QDII">QDII</span>
                <span class="filter-chip" data-filter="LOF">LOF</span>
            </div>
            <div class="fund-table-wrap" id="searchResultTable">
                <div style="padding: 40px; text-align: center;">
                    <div class="loader" style="margin: 0 auto 12px;"></div>
                    <p style="color: var(--text-secondary);">正在搜索基金...</p>
                </div>
            </div>
        `;

        // 筛选器事件
        var currentFilter = 'all';
        var searchResults = [];

        document.querySelectorAll('.filter-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                document.querySelectorAll('.filter-chip').forEach(function (c) { c.classList.remove('active'); });
                this.classList.add('active');
                currentFilter = this.dataset.filter;
                renderSearchResults(searchResults, currentFilter);
            });
        });

        // 执行搜索
        performSearch(keyword).then(function (results) {
            searchResults = results;
            renderSearchResults(searchResults, currentFilter);

            // 更新搜索结果头部
            var header = app.querySelector('.search-results-header p');
            if (header) {
                header.textContent = '共找到 ' + results.length + ' 只基金';
            }
        });
    }

    async function performSearch(keyword) {
        var results = await FundAPI.searchFunds(keyword);

        // 如果结果较少,尝试获取实时估值补充
        if (results.length > 0 && results.length <= 20) {
            var codes = results.map(function (r) { return r.code; });
            var estimates = await FundAPI.batchRealtimeEstimate(codes);
            results = results.map(function (r) {
                var est = estimates.find(function (e) { return e.fundcode === r.code; });
                r.dwjz = est ? est.dwjz : 0;
                r.gsz = est ? est.gsz : 0;
                r.gszzl = est ? est.gszzl : 0;
                r.gztime = est ? est.gztime : '';
                return r;
            });
        }

        return results;
    }

    function renderSearchResults(results, filter) {
        var container = document.getElementById('searchResultTable');
        if (!container) return;

        var filtered = filter === 'all' ? results : results.filter(function (r) {
            return r.category === filter || r.type === filter;
        });

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">🔍</div>
                    <h3>未找到相关基金</h3>
                    <p>试试其他关键词,如基金代码、名称或拼音首字母</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <table class="fund-table">
                <thead>
                    <tr>
                        <th>基金名称</th>
                        <th class="text-right">最新净值</th>
                        <th class="text-right">估值</th>
                        <th class="text-right">涨跌幅</th>
                        <th class="text-right">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${filtered.map(function (f) {
                        var change = f.gszzl || 0;
                        var changeClass = FundAPI.getChangeClass(change);
                        var isFav = Store.isFavorite(f.code);
                        return `
                            <tr data-code="${f.code}">
                                <td class="col-name">
                                    <div class="fund-name-cell">
                                        <span class="name">${f.name || f.shortName}</span>
                                        <span class="code">${f.code} · ${f.category || f.type || ''}</span>
                                    </div>
                                </td>
                                <td class="num-cell">${f.dwjz ? FundAPI.formatNum(f.dwjz) : '--'}</td>
                                <td class="num-cell">${f.gsz ? FundAPI.formatNum(f.gsz) : '--'}</td>
                                <td class="num-cell">
                                    <span class="change-badge ${changeClass === 'up' ? 'bg-up' : changeClass === 'down' ? 'bg-down' : 'bg-flat'}">
                                        ${FundAPI.formatChange(change)}
                                    </span>
                                </td>
                                <td>
                                    <button class="action-btn" data-action="${isFav ? 'remove' : 'add'}" data-code="${f.code}" data-name="${f.name || f.shortName}" data-type="${f.category || f.type}">
                                        ${isFav ? '移除自选' : '+ 自选'}
                                    </button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;

        // 绑定事件
        container.querySelectorAll('tr[data-code]').forEach(function (tr) {
            tr.addEventListener('click', function (e) {
                if (e.target.classList.contains('action-btn')) return;
                openDetail(this.dataset.code);
            });
        });

        container.querySelectorAll('.action-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                handleFavToggle(this);
            });
        });
    }

    // ========== 持仓页 ==========
    function renderPortfolio() {
        var positions = Store.getAggregatedPositions();

        app.innerHTML = `
            <div class="favorites-header">
                <h2 style="font-size: 20px;">💼 我的持仓</h2>
                <div class="portfolio-toolbar">
                    <span class="refresh-info" id="refreshInfo">
                        <span class="refresh-dot"></span>
                        <span id="refreshStatus">加载中...</span>
                    </span>
                    <button class="refresh-btn" id="manualRefreshBtn" title="手动刷新">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
                        刷新
                    </button>
                    <label class="auto-refresh-toggle">
                        <input type="checkbox" id="autoRefreshCheckbox" checked>
                        <span class="toggle-slider"></span>
                        <span class="toggle-label">自动刷新</span>
                    </label>
                </div>
                <button class="add-holding-btn" id="addHoldingBtn">+ 添加持仓</button>
            </div>
            <div id="portfolioContent">
                <div style="padding: 40px; text-align: center;">
                    <div class="loader" style="margin: 0 auto 12px;"></div>
                    <span style="color: var(--text-secondary);">正在加载持仓数据...</span>
                </div>
            </div>
        `;

        // 绑定添加持仓按钮
        document.getElementById('addHoldingBtn').addEventListener('click', function () {
            showHoldingForm({});
        });

        // 绑定手动刷新
        document.getElementById('manualRefreshBtn').addEventListener('click', function () {
            refreshPortfolioData();
        });

        // 绑定自动刷新开关
        document.getElementById('autoRefreshCheckbox').addEventListener('change', function () {
            if (this.checked) {
                startPortfolioAutoRefresh();
            } else {
                stopPortfolioAutoRefresh();
            }
        });

        loadPortfolioData(positions);
    }

    async function loadPortfolioData(positions) {
        var container = document.getElementById('portfolioContent');
        if (!container) return;

        if (positions.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">💼</div>
                    <h3>还没有添加持仓</h3>
                    <p>添加你的基金持仓,实时跟踪盈亏情况</p>
                    <button class="add-holding-btn" style="margin-top: 16px;" id="emptyAddHoldingBtn">+ 添加持仓</button>
                </div>
            `;
            var emptyBtn = document.getElementById('emptyAddHoldingBtn');
            if (emptyBtn) {
                emptyBtn.addEventListener('click', function () {
                    showHoldingForm({});
                });
            }
            return;
        }

        // 获取所有持仓基金的实时估值
        var codes = positions.map(function (p) { return p.code; });
        var estimates = await FundAPI.batchRealtimeEstimate(codes);

        // 构建净值映射
        var navMap = {};
        positions.forEach(function (p) {
            var est = estimates.find(function (e) { return e.fundcode === p.code; });
            if (est) {
                navMap[p.code] = est.gsz || est.dwjz || p.costPrice;
            } else {
                navMap[p.code] = p.costPrice;
            }
        });

        // 计算总盈亏
        var totals = Store.calcTotalAggregatedProfit(positions, navMap);
        var profitClass = totals.totalHoldingProfit >= 0 ? 'profit-positive' : 'profit-negative';
        var profitSign = totals.totalHoldingProfit >= 0 ? '+' : '';
        var cumClass = totals.totalCumulativeProfit >= 0 ? 'profit-positive' : 'profit-negative';
        var cumSign = totals.totalCumulativeProfit >= 0 ? '+' : '';

        // 渲染持仓总览 + 持仓表格
        container.innerHTML = `
            <div class="portfolio-summary">
                <div class="summary-header">
                    <span class="summary-title">📊 持仓总览</span>
                    <span class="summary-count">共 ${positions.length} 只基金</span>
                </div>
                <div class="summary-grid summary-grid-5">
                    <div class="summary-item">
                        <div class="summary-label">持仓市值</div>
                        <div class="summary-value" data-summary="totalValue">¥${formatMoney(totals.totalValue)}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">持仓成本</div>
                        <div class="summary-value" data-summary="totalCost">¥${formatMoney(totals.totalCost)}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">持仓收益</div>
                        <div class="summary-value ${profitClass}" data-summary="holdingProfit">${profitSign}${formatMoney(totals.totalHoldingProfit)}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">收益率</div>
                        <div class="summary-value ${profitClass}" data-summary="profitRate">${profitSign}${(totals.totalProfitRate * 100).toFixed(2)}%</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">累计收益</div>
                        <div class="summary-value ${cumClass}" data-summary="cumulativeProfit">${cumSign}${formatMoney(totals.totalCumulativeProfit)}</div>
                    </div>
                </div>
            </div>

            <div class="fund-table-wrap">
                <table class="fund-table portfolio-table">
                    <thead>
                        <tr>
                            <th>基金名称</th>
                            <th class="text-right">持有份额</th>
                            <th class="text-right">成本价</th>
                            <th class="text-right">最新净值</th>
                            <th class="text-right">持仓市值</th>
                            <th class="text-right">持仓收益</th>
                            <th class="text-right">收益率</th>
                            <th class="text-right">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${positions.map(function (p) {
                            var currentNav = navMap[p.code] || p.costPrice;
                            var calc = Store.calcPositionProfit(p, currentNav);
                            var pClass = calc.holdingProfit >= 0 ? 'profit-positive' : 'profit-negative';
                            var pSign = calc.holdingProfit >= 0 ? '+' : '';
                            var est = estimates.find(function (e) { return e.fundcode === p.code; });
                            var displayName = (est && est.name) || p.name;
                            var clearedBadge = p.isCleared ? '<span class="cleared-badge">已清仓</span>' : '';
                            return `
                                <tr data-code="${p.code}">
                                    <td class="col-name">
                                        <div class="fund-name-cell">
                                            <span class="name">${displayName} ${clearedBadge}</span>
                                            <span class="code">${p.code} · ${p.type || ''} · ${p.transactionCount}笔交易</span>
                                        </div>
                                    </td>
                                    <td class="num-cell">${p.currentShares.toFixed(2)}</td>
                                    <td class="num-cell">${FundAPI.formatNum(p.costPrice)}</td>
                                    <td class="num-cell" data-cell="nav" data-code="${p.code}">${FundAPI.formatNum(currentNav)}</td>
                                    <td class="num-cell" data-cell="value" data-code="${p.code}">¥${formatMoney(calc.currentValue)}</td>
                                    <td class="num-cell ${pClass}" data-cell="profit" data-code="${p.code}">${pSign}${formatMoney(calc.holdingProfit)}</td>
                                    <td class="num-cell" data-cell="rate" data-code="${p.code}">
                                        <span class="change-badge ${pClass === 'profit-positive' ? 'bg-up' : 'bg-down'}">
                                            ${pSign}${(calc.holdingProfitRate * 100).toFixed(2)}%
                                        </span>
                                    </td>
                                    <td class="action-cell">
                                        <button class="action-btn add-position" data-action="add-position" data-code="${p.code}">加仓</button>
                                        ${p.isCleared ? '' : '<button class="action-btn sell-position" data-action="reduce-position" data-code="' + p.code + '">减仓</button>'}
                                        <button class="action-btn" data-action="delete-fund" data-code="${p.code}">删除</button>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;

        // 绑定行点击事件
        container.querySelectorAll('tr[data-code]').forEach(function (tr) {
            tr.addEventListener('click', function (e) {
                if (e.target.classList.contains('action-btn')) return;
                openDetail(this.dataset.code);
            });
        });

        // 绑定加仓按钮
        container.querySelectorAll('.action-btn[data-action="add-position"]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var code = this.dataset.code;
                var position = positions.find(function (p) { return p.code === code; });
                if (position) {
                    showAddPositionForm(position);
                }
            });
        });

        // 绑定减仓按钮
        container.querySelectorAll('.action-btn[data-action="reduce-position"]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var code = this.dataset.code;
                var position = positions.find(function (p) { return p.code === code; });
                if (position) {
                    showReducePositionForm(position);
                }
            });
        });

        // 绑定删除按钮
        container.querySelectorAll('.action-btn[data-action="delete-fund"]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var code = this.dataset.code;
                var position = positions.find(function (p) { return p.code === code; });
                if (!position) return;
                if (confirm('确定删除「' + (position.name || code) + '」的所有交易记录？此操作不可撤销。')) {
                    var result = Store.removeFundTransactions(code);
                    showToast(result.message, result.success ? 'success' : 'error');
                    if (result.success) {
                        renderPortfolio();
                    }
                }
            });
        });

        // 首次加载完成，启动自动刷新
        updateRefreshStatus(true);
        startPortfolioAutoRefresh();
    }

    // ========== 持仓实时刷新 ==========
    var REFRESH_INTERVAL = 30; // 自动刷新间隔（秒）
    var countdownLeft = REFRESH_INTERVAL;

    function startPortfolioAutoRefresh() {
        stopPortfolioAutoRefresh();
        var checkbox = document.getElementById('autoRefreshCheckbox');
        if (!checkbox || !checkbox.checked) return;

        countdownLeft = REFRESH_INTERVAL;
        // 倒计时定时器（每秒更新）
        portfolioRefreshCountdown = setInterval(function () {
            countdownLeft--;
            if (countdownLeft <= 0) {
                countdownLeft = REFRESH_INTERVAL;
                refreshPortfolioData();
            }
            updateCountdownDisplay();
        }, 1000);
        updateCountdownDisplay();
    }

    function stopPortfolioAutoRefresh() {
        if (portfolioTimer) { clearInterval(portfolioTimer); portfolioTimer = null; }
        if (portfolioRefreshCountdown) { clearInterval(portfolioRefreshCountdown); portfolioRefreshCountdown = null; }
    }

    function updateCountdownDisplay() {
        var statusEl = document.getElementById('refreshStatus');
        if (!statusEl) return;
        var checkbox = document.getElementById('autoRefreshCheckbox');
        if (checkbox && !checkbox.checked) {
            statusEl.textContent = '已暂停';
            return;
        }
        statusEl.textContent = countdownLeft + 's 后刷新';
    }

    function updateRefreshStatus(isSuccess) {
        var statusEl = document.getElementById('refreshStatus');
        if (!statusEl) return;
        var now = new Date();
        var timeStr = String(now.getHours()).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0') + ':' +
            String(now.getSeconds()).padStart(2, '0');
        statusEl.textContent = (isSuccess ? '已更新 ' : '更新失败 ') + timeStr;
    }

    // 仅刷新数据，不重新渲染整个表格（避免闪烁、保留滚动位置）
    async function refreshPortfolioData() {
        var container = document.getElementById('portfolioContent');
        if (!container) return;

        var positions = Store.getAggregatedPositions();
        if (positions.length === 0) return;

        var codes = positions.map(function (p) { return p.code; });

        // 显示刷新动画
        var refreshBtn = document.getElementById('manualRefreshBtn');
        if (refreshBtn) refreshBtn.classList.add('spinning');

        var estimates = await FundAPI.batchRealtimeEstimate(codes);

        if (refreshBtn) refreshBtn.classList.remove('spinning');

        if (!estimates || estimates.length === 0) {
            updateRefreshStatus(false);
            countdownLeft = REFRESH_INTERVAL;
            return;
        }

        // 构建净值映射
        var navMap = {};
        positions.forEach(function (p) {
            var est = estimates.find(function (e) { return e.fundcode === p.code; });
            if (est) {
                navMap[p.code] = est.gsz || est.dwjz || p.costPrice;
            } else {
                navMap[p.code] = p.costPrice;
            }
        });

        // 更新总览数据
        var totals = Store.calcTotalAggregatedProfit(positions, navMap);
        updateSummaryCell('totalValue', '¥' + formatMoney(totals.totalValue));
        updateSummaryCell('totalCost', '¥' + formatMoney(totals.totalCost));

        var profitClass = totals.totalHoldingProfit >= 0 ? 'profit-positive' : 'profit-negative';
        var profitSign = totals.totalHoldingProfit >= 0 ? '+' : '';
        updateSummaryCell('holdingProfit', profitSign + formatMoney(totals.totalHoldingProfit), profitClass);
        updateSummaryCell('profitRate', profitSign + (totals.totalProfitRate * 100).toFixed(2) + '%', profitClass);

        var cumClass = totals.totalCumulativeProfit >= 0 ? 'profit-positive' : 'profit-negative';
        var cumSign = totals.totalCumulativeProfit >= 0 ? '+' : '';
        updateSummaryCell('cumulativeProfit', cumSign + formatMoney(totals.totalCumulativeProfit), cumClass);

        // 更新每行数据
        positions.forEach(function (p) {
            var currentNav = navMap[p.code] || p.costPrice;
            var calc = Store.calcPositionProfit(p, currentNav);
            var pClass = calc.holdingProfit >= 0 ? 'profit-positive' : 'profit-negative';
            var pSign = calc.holdingProfit >= 0 ? '+' : '';

            updateTableCell('nav', p.code, FundAPI.formatNum(currentNav));
            updateTableCell('value', p.code, '¥' + formatMoney(calc.currentValue));
            updateTableCell('profit', p.code, pSign + formatMoney(calc.holdingProfit), pClass);
            updateTableCell('rate', p.code,
                '<span class="change-badge ' + (pClass === 'profit-positive' ? 'bg-up' : 'bg-down') + '">' +
                pSign + (calc.holdingProfitRate * 100).toFixed(2) + '%</span>');
        });

        updateRefreshStatus(true);
        countdownLeft = REFRESH_INTERVAL;
    }

    function updateSummaryCell(key, text, className) {
        var el = document.querySelector('[data-summary="' + key + '"]');
        if (!el) return;
        el.textContent = text;
        if (className !== undefined) {
            el.className = 'summary-value ' + className;
        }
        // 闪烁高亮
        el.classList.add('flash-update');
        setTimeout(function () { el.classList.remove('flash-update'); }, 600);
    }

    function updateTableCell(cellType, code, html, className) {
        var el = document.querySelector('[data-cell="' + cellType + '"][data-code="' + code + '"]');
        if (!el) return;
        el.innerHTML = html;
        if (className !== undefined) {
            el.className = 'num-cell ' + className;
        } else {
            el.className = 'num-cell';
        }
        el.classList.add('flash-update');
        setTimeout(function () { el.classList.remove('flash-update'); }, 600);
    }

    // ========== 添加持仓表单 ==========
    function showHoldingForm(data) {
        var holdingModal = document.getElementById('holdingModal');
        var holdingFormContent = document.getElementById('holdingFormContent');
        var code = data.code || '';
        var name = data.name || '';
        var type = data.type || '';
        var currentNav = data.defaultPrice || '';  // 从详情弹窗传入的当前净值

        holdingFormContent.innerHTML = `
            <div class="form-header">
                <h3>💼 添加基金持仓</h3>
            </div>
            <div class="form-body">
                <div class="form-group">
                    <label class="form-label">基金代码 <span class="required">*</span></label>
                    <input type="text" class="form-input" id="holdingCode" value="${code}" placeholder="如 161725" ${code ? 'readonly' : ''}>
                </div>
                <div class="form-group">
                    <label class="form-label">基金名称</label>
                    <input type="text" class="form-input" id="holdingName" value="${name}" placeholder="输入代码后自动填充" readonly style="background: #f5f7fa;">
                </div>
                <div class="form-group">
                    <label class="form-label">基金类型</label>
                    <input type="text" class="form-input" id="holdingType" value="${type}" placeholder="输入代码后自动填充" readonly style="background: #f5f7fa;">
                </div>
                <div class="form-group">
                    <label class="form-label">持有金额(元) <span class="required">*</span></label>
                    <input type="number" class="form-input" id="holdingAmount" value="" step="0.01" placeholder="如 1000">
                </div>
                <div class="form-group">
                    <label class="form-label">买入日期</label>
                    <input type="date" class="form-input" id="holdingBuyDate" value="">
                </div>
                <div class="form-actions">
                    <button class="form-cancel" id="holdingCancelBtn">取消</button>
                    <button class="form-submit" id="holdingSubmitBtn">确认添加</button>
                </div>
            </div>
        `;

        holdingModal.classList.add('active');

        // 内部存储获取到的净值（作为买入价）
        var fetchedNav = currentNav || '';

        // 自动填充基金信息（名称、类型）并获取净值
        function autoFillFundInfo(codeToSearch) {
            FundAPI.searchFunds(codeToSearch).then(function (results) {
                var match = results.find(function (r) { return r.code === codeToSearch; });
                if (match) {
                    document.getElementById('holdingName').value = match.name || match.shortName || '';
                    document.getElementById('holdingType').value = match.category || match.type || '';
                }
            });
            // 同时获取当前净值
            if (!fetchedNav) {
                FundAPI.getRealtimeEstimate(codeToSearch).then(function (est) {
                    if (est) {
                        fetchedNav = est.gsz || est.dwjz || '';
                    }
                });
            }
        }

        // 如果有代码但没有名称，自动搜索
        if (code && !name) {
            autoFillFundInfo(code);
        }
        // 如果有代码但没有净值，获取净值
        if (code && !fetchedNav) {
            FundAPI.getRealtimeEstimate(code).then(function (est) {
                if (est) {
                    fetchedNav = est.gsz || est.dwjz || '';
                }
            });
        }

        // 绑定代码输入框：失焦时自动填充
        var codeInput = document.getElementById('holdingCode');
        if (codeInput && !codeInput.readOnly) {
            codeInput.addEventListener('blur', function () {
                var enteredCode = this.value.trim();
                if (enteredCode.length >= 5) {
                    autoFillFundInfo(enteredCode);
                }
            });
        }

        // 设置默认日期为今天
        var today = new Date();
        var dateStr = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');
        var dateInput = document.getElementById('holdingBuyDate');
        if (!dateInput.value) dateInput.value = dateStr;

        // 绑定取消按钮
        document.getElementById('holdingCancelBtn').addEventListener('click', function () {
            holdingModal.classList.remove('active');
        });

        // 绑定提交按钮
        document.getElementById('holdingSubmitBtn').addEventListener('click', function () {
            var submitCode = document.getElementById('holdingCode').value.trim();
            var submitName = document.getElementById('holdingName').value.trim();
            var submitType = document.getElementById('holdingType').value.trim();
            var amount = parseFloat(document.getElementById('holdingAmount').value);
            var buyDate = document.getElementById('holdingBuyDate').value;

            if (!submitCode) {
                showToast('请输入基金代码', 'warning');
                return;
            }
            if (!amount || amount <= 0) {
                showToast('请输入有效的持有金额', 'warning');
                return;
            }

            // 如果还没有获取到净值，先获取再提交
            if (!fetchedNav || parseFloat(fetchedNav) <= 0) {
                showToast('正在获取基金净值，请稍后...', 'warning');
                FundAPI.getRealtimeEstimate(submitCode).then(function (est) {
                    if (est && (est.gsz || est.dwjz)) {
                        fetchedNav = est.gsz || est.dwjz;
                        doSubmit();
                    } else {
                        showToast('无法获取基金净值，请检查基金代码', 'error');
                    }
                });
            } else {
                doSubmit();
            }

            function doSubmit() {
                var result = Store.addHolding({
                    code: submitCode,
                    name: submitName || submitCode,
                    type: submitType,
                    amount: amount,
                    buyPrice: parseFloat(fetchedNav),
                    buyDate: buyDate
                });

                showToast(result.message, result.success ? 'success' : 'error');
                if (result.success) {
                    holdingModal.classList.remove('active');
                    // 如果当前在持仓页,刷新
                    if (location.hash.indexOf('/portfolio') !== -1) {
                        renderPortfolio();
                    }
                    // 如果当前在首页,刷新持仓概览
                    if (location.hash === '#/' || location.hash === '') {
                        loadPortfolioOverview();
                    }
                }
            }
        });
    }

    // ========== 加仓表单 ==========
    function showAddPositionForm(position) {
        var holdingModal = document.getElementById('holdingModal');
        var holdingFormContent = document.getElementById('holdingFormContent');

        holdingFormContent.innerHTML = `
            <div class="form-header">
                <h3>📈 加仓 · ${position.name || position.code}</h3>
            </div>
            <div class="form-body">
                <div class="form-group">
                    <label class="form-label">基金代码</label>
                    <input type="text" class="form-input" value="${position.code}" readonly style="background: #f5f7fa;">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">当前持有份额</label>
                        <input type="text" class="form-input" value="${position.currentShares.toFixed(2)} 份" readonly style="background: #f5f7fa;">
                    </div>
                    <div class="form-group">
                        <label class="form-label">成本价</label>
                        <input type="text" class="form-input" value="${FundAPI.formatNum(position.costPrice)}" readonly style="background: #f5f7fa;">
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">当前净值（买入价）</label>
                    <input type="text" class="form-input" id="addPosNav" value="获取中..." readonly style="background: #f5f7fa;">
                </div>
                <div class="form-group">
                    <label class="form-label">加仓金额(元) <span class="required">*</span></label>
                    <input type="number" class="form-input" id="addPosAmount" value="" step="0.01" placeholder="如 500">
                </div>
                <div class="form-group">
                    <label class="form-label">买入日期</label>
                    <input type="date" class="form-input" id="addPosDate" value="">
                </div>
                <div class="form-actions">
                    <button class="form-cancel" id="addPosCancelBtn">取消</button>
                    <button class="form-submit" id="addPosSubmitBtn">确认加仓</button>
                </div>
            </div>
        `;

        holdingModal.classList.add('active');

        // 获取当前净值作为买入价
        var currentNav = '';
        FundAPI.getRealtimeEstimate(position.code).then(function (est) {
            if (est) {
                currentNav = est.gsz || est.dwjz || '';
                var navInput = document.getElementById('addPosNav');
                if (navInput) {
                    navInput.value = currentNav ? FundAPI.formatNum(parseFloat(currentNav)) : '获取失败';
                }
            } else {
                var navInput2 = document.getElementById('addPosNav');
                if (navInput2) navInput2.value = '获取失败';
            }
        });

        // 设置默认日期为今天
        var today = new Date();
        var dateStr = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');
        document.getElementById('addPosDate').value = dateStr;

        // 取消按钮
        document.getElementById('addPosCancelBtn').addEventListener('click', function () {
            holdingModal.classList.remove('active');
        });

        // 提交按钮
        document.getElementById('addPosSubmitBtn').addEventListener('click', function () {
            var amount = parseFloat(document.getElementById('addPosAmount').value);
            var buyDate = document.getElementById('addPosDate').value;

            if (!amount || amount <= 0) {
                showToast('请输入有效的加仓金额', 'warning');
                return;
            }

            if (!currentNav || parseFloat(currentNav) <= 0) {
                showToast('正在获取基金净值，请稍后...', 'warning');
                FundAPI.getRealtimeEstimate(position.code).then(function (est) {
                    if (est && (est.gsz || est.dwjz)) {
                        currentNav = est.gsz || est.dwjz;
                        doAddPosition();
                    } else {
                        showToast('无法获取基金净值，请稍后重试', 'error');
                    }
                });
            } else {
                doAddPosition();
            }

            function doAddPosition() {
                var result = Store.addHolding({
                    code: position.code,
                    name: position.name || position.code,
                    type: position.type || '',
                    amount: amount,
                    buyPrice: parseFloat(currentNav),
                    buyDate: buyDate
                });

                showToast(result.message, result.success ? 'success' : 'error');
                if (result.success) {
                    holdingModal.classList.remove('active');
                    renderPortfolio();
                }
            }
        });
    }

    // ========== 减仓表单 ==========
    function showReducePositionForm(position) {
        var holdingModal = document.getElementById('holdingModal');
        var holdingFormContent = document.getElementById('holdingFormContent');

        holdingFormContent.innerHTML = `
            <div class="form-header">
                <h3>📉 减仓 · ${position.name || position.code}</h3>
            </div>
            <div class="form-body">
                <div class="form-group">
                    <label class="form-label">基金代码</label>
                    <input type="text" class="form-input" value="${position.code}" readonly style="background: #f5f7fa;">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">持有份额</label>
                        <input type="text" class="form-input" value="${position.currentShares.toFixed(2)} 份" readonly style="background: #f5f7fa;">
                    </div>
                    <div class="form-group">
                        <label class="form-label">成本价</label>
                        <input type="text" class="form-input" value="${FundAPI.formatNum(position.costPrice)}" readonly style="background: #f5f7fa;">
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">当前净值（赎回价）</label>
                    <input type="text" class="form-input" id="reducePosNav" value="获取中..." readonly style="background: #f5f7fa;">
                </div>
                <div class="form-group">
                    <label class="form-label">赎回份额 <span class="required">*</span></label>
                    <div style="display:flex; gap:8px;">
                        <input type="number" class="form-input" id="reducePosShares" value="" step="0.01" placeholder="输入赎回份额" style="flex:1;">
                        <button class="form-submit" id="reduceAllBtn" style="white-space:nowrap; padding:8px 16px;">全部</button>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">赎回日期</label>
                    <input type="date" class="form-input" id="reducePosDate" value="">
                </div>
                <div class="form-preview" id="reducePreview" style="display:none;">
                    <div class="preview-row"><span>预计到账金额</span><span id="previewAmount" class="preview-value">--</span></div>
                    <div class="preview-row"><span>预计收益</span><span id="previewProfit" class="preview-value">--</span></div>
                </div>
                <div class="form-actions">
                    <button class="form-cancel" id="reducePosCancelBtn">取消</button>
                    <button class="form-submit" id="reducePosSubmitBtn">确认减仓</button>
                </div>
            </div>
        `;

        holdingModal.classList.add('active');

        // 获取当前净值作为赎回价
        var currentNav = '';
        FundAPI.getRealtimeEstimate(position.code).then(function (est) {
            if (est) {
                currentNav = est.gsz || est.dwjz || '';
                var navInput = document.getElementById('reducePosNav');
                if (navInput) {
                    navInput.value = currentNav ? FundAPI.formatNum(parseFloat(currentNav)) : '获取失败';
                }
                updatePreview();
            } else {
                var navInput2 = document.getElementById('reducePosNav');
                if (navInput2) navInput2.value = '获取失败';
            }
        });

        // 设置默认日期为今天
        var today = new Date();
        var dateStr = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');
        document.getElementById('reducePosDate').value = dateStr;

        // 更新预览
        function updatePreview() {
            var sharesInput = document.getElementById('reducePosShares');
            var shares = parseFloat(sharesInput.value) || 0;
            var preview = document.getElementById('reducePreview');
            if (shares > 0 && currentNav && parseFloat(currentNav) > 0) {
                var nav = parseFloat(currentNav);
                var amount = shares * nav;
                var profit = shares * (nav - position.costPrice);
                var profitStr = (profit >= 0 ? '+' : '') + profit.toFixed(2);
                document.getElementById('previewAmount').textContent = '¥' + amount.toFixed(2);
                document.getElementById('previewProfit').textContent = profitStr;
                document.getElementById('previewProfit').style.color = profit >= 0 ? '#f5222d' : '#52c41a';
                preview.style.display = 'block';
            } else {
                preview.style.display = 'none';
            }
        }

        // 份额输入时更新预览
        document.getElementById('reducePosShares').addEventListener('input', updatePreview);

        // 全部按钮
        document.getElementById('reduceAllBtn').addEventListener('click', function () {
            document.getElementById('reducePosShares').value = position.currentShares.toFixed(2);
            updatePreview();
        });

        // 取消按钮
        document.getElementById('reducePosCancelBtn').addEventListener('click', function () {
            holdingModal.classList.remove('active');
        });

        // 提交按钮
        document.getElementById('reducePosSubmitBtn').addEventListener('click', function () {
            var shares = parseFloat(document.getElementById('reducePosShares').value);
            var sellDate = document.getElementById('reducePosDate').value;

            if (!shares || shares <= 0) {
                showToast('请输入有效的赎回份额', 'warning');
                return;
            }

            if (shares > position.currentShares + 0.0001) {
                showToast('赎回份额不能超过持有份额（' + position.currentShares.toFixed(2) + '份）', 'warning');
                return;
            }

            if (!currentNav || parseFloat(currentNav) <= 0) {
                showToast('正在获取基金净值，请稍后...', 'warning');
                FundAPI.getRealtimeEstimate(position.code).then(function (est) {
                    if (est && (est.gsz || est.dwjz)) {
                        currentNav = est.gsz || est.dwjz;
                        doReducePosition();
                    } else {
                        showToast('无法获取基金净值，请稍后重试', 'error');
                    }
                });
            } else {
                doReducePosition();
            }

            function doReducePosition() {
                var result = Store.addSellTransaction({
                    code: position.code,
                    name: position.name || position.code,
                    type: position.type || '',
                    shares: shares,
                    price: parseFloat(currentNav),
                    date: sellDate
                });

                showToast(result.message, result.success ? 'success' : 'error');
                if (result.success) {
                    holdingModal.classList.remove('active');
                    renderPortfolio();
                }
            }
        });
    }

    // ========== 自选页 ==========
    function renderFavorites() {
        var favorites = Store.getFavorites();
        var groups = Store.getGroups();
        var currentGroup = '全部';

        app.innerHTML = `
            <div class="favorites-header">
                <h2 style="font-size: 20px;">我的自选</h2>
                <span style="color: var(--text-secondary); font-size: 14px;">共 ${favorites.length} 只基金</span>
            </div>

            <div class="favorites-tabs" id="favTabs">
                ${groups.map(function (g) {
                    return '<span class="fav-tab ' + (g === currentGroup ? 'active' : '') + '" data-group="' + g + '">' + g + '</span>';
                }).join('')}
                <span class="fav-tab fav-tab-add" id="addGroupBtn">+ 新建分组</span>
            </div>

            <div id="favContent"></div>
        `;

        // 分组切换
        document.querySelectorAll('.fav-tab[data-group]').forEach(function (tab) {
            tab.addEventListener('click', function () {
                document.querySelectorAll('.fav-tab').forEach(function (t) { t.classList.remove('active'); });
                this.classList.add('active');
                currentGroup = this.dataset.group;
                renderFavContent(favorites, currentGroup, groups);
            });
        });

        // 新建分组
        document.getElementById('addGroupBtn').addEventListener('click', function () {
            var name = prompt('请输入分组名称:');
            if (name) {
                var result = Store.addGroup(name);
                showToast(result.message, result.success ? 'success' : 'error');
                if (result.success) {
                    renderFavorites();
                }
            }
        });

        renderFavContent(favorites, currentGroup, groups);
    }

    function renderFavContent(favorites, group, groups) {
        var container = document.getElementById('favContent');
        if (!container) return;

        var filtered = group === '全部' ? favorites : favorites.filter(function (f) { return f.group === group; });

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">⭐</div>
                    <h3>${group === '全部' ? '还没有添加自选基金' : '该分组暂无基金'}</h3>
                    <p>去搜索并添加你关注的基金吧!</p>
                    <button class="add-fav-btn" style="margin-top: 16px;" onclick="location.hash='/search'">去搜索基金</button>
                </div>
            `;
            return;
        }

        // 先显示骨架
        container.innerHTML = `
            <div class="fund-table-wrap">
                <table class="fund-table">
                    <thead>
                        <tr>
                            <th>基金名称</th>
                            <th class="text-right">最新净值</th>
                            <th class="text-right">盘中估值</th>
                            <th class="text-right">估算涨跌</th>
                            <th class="text-right">估值时间</th>
                            <th class="text-right">操作</th>
                        </tr>
                    </thead>
                    <tbody id="favTbody">
                        <tr><td colspan="6" style="padding: 40px; text-align: center;">
                            <div class="loader" style="margin: 0 auto 12px;"></div>
                            <span style="color: var(--text-secondary);">正在加载实时数据...</span>
                        </td></tr>
                    </tbody>
                </table>
            </div>
        `;

        // 异步加载实时数据
        loadFavRealtimeData(filtered, group, groups);
    }

    async function loadFavRealtimeData(favorites, group, groups) {
        var tbody = document.getElementById('favTbody');
        if (!tbody) return;

        var codes = favorites.map(function (f) { return f.code; });
        var estimates = await FundAPI.batchRealtimeEstimate(codes);

        tbody.innerHTML = favorites.map(function (f) {
            var est = estimates.find(function (e) { return e.fundcode === f.code; });
            var dwjz = est ? est.dwjz : 0;
            var gsz = est ? est.gsz : 0;
            var gszzl = est ? est.gszzl : 0;
            var gztime = est ? est.gztime : '';
            var changeClass = FundAPI.getChangeClass(gszzl);
            var isEstimate = gsz && gsz !== dwjz;

            return `
                <tr data-code="${f.code}">
                    <td class="col-name">
                        <div class="fund-name-cell">
                            <span class="name">${est ? est.name : f.name}</span>
                            <span class="code">${f.code} · ${f.type || ''} ${group !== '全部' ? '' : '· ' + (f.group || '全部')}</span>
                        </div>
                    </td>
                    <td class="num-cell">${dwjz ? FundAPI.formatNum(dwjz) : '--'}</td>
                    <td class="num-cell ${isEstimate ? changeClass : ''}">${gsz ? FundAPI.formatNum(gsz) : '--'}</td>
                    <td class="num-cell">
                        <span class="change-badge ${changeClass === 'up' ? 'bg-up' : changeClass === 'down' ? 'bg-down' : 'bg-flat'}">
                            ${FundAPI.formatChange(gszzl)}
                        </span>
                    </td>
                    <td class="num-cell" style="font-weight: 400; color: var(--text-secondary); font-size: 12px;">
                        ${gztime ? FundAPI.formatDate(gztime, 'MM-DD HH:mm') : '--'}
                    </td>
                    <td>
                        ${group !== '全部' ? '' : ''}
                        <button class="action-btn" data-action="remove" data-code="${f.code}">移除</button>
                    </td>
                </tr>
            `;
        }).join('');

        // 绑定事件
        tbody.querySelectorAll('tr[data-code]').forEach(function (tr) {
            tr.addEventListener('click', function (e) {
                if (e.target.classList.contains('action-btn')) return;
                openDetail(this.dataset.code);
            });
        });

        tbody.querySelectorAll('.action-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var code = this.dataset.code;
                Store.removeFavorite(code);
                showToast('已移除自选', 'success');
                renderFavorites();
            });
        });
    }

    // ========== 基金详情弹窗 ==========
    async function openDetail(fundCode) {
        currentDetailCode = fundCode;
        detailModal.classList.add('active');
        detailContent.innerHTML = `
            <div style="padding: 80px; text-align: center;">
                <div class="loader" style="margin: 0 auto 16px;"></div>
                <p style="color: var(--text-secondary);">正在加载基金详情...</p>
            </div>
        `;

        // 并行获取数据
        var [detail, estimate, trend] = await Promise.all([
            FundAPI.getFundDetail(fundCode),
            FundAPI.getRealtimeEstimate(fundCode),
            FundAPI.getNavTrend(fundCode)
        ]);

        // 如果详情为空,用估值数据兜底
        if (!detail && estimate) {
            detail = {
                code: fundCode,
                name: estimate.name,
                typeDesc: '混合型',
                company: '--',
                manager: trend && trend.currentFundManager ? trend.currentFundManager : '--',
                establishDate: '--',
                scale: '--',
                netValue: estimate.dwjz,
                netValueDate: estimate.jzrq,
                totalNetValue: 0,
                change: 0
            };
        }

        // 如果还是为空,用trend数据兜底
        if (!detail && trend) {
            detail = {
                code: fundCode,
                name: trend.name,
                typeDesc: '混合型',
                company: '--',
                manager: trend.currentFundManager || '--',
                establishDate: '--',
                scale: '--',
                netValue: 0,
                netValueDate: '',
                totalNetValue: 0,
                change: 0
            };
        }

        if (!detail) {
            detailContent.innerHTML = `
                <div class="empty-state">
                    <div class="icon">😕</div>
                    <h3>加载失败</h3>
                    <p>无法获取基金 ${fundCode} 的数据,请稍后重试</p>
                    <button class="add-fav-btn" style="margin-top: 16px;" onclick="document.getElementById('modalClose').click()">关闭</button>
                </div>
            `;
            return;
        }

        var isFav = Store.isFavorite(fundCode);
        var changeClass = FundAPI.getChangeClass(estimate ? estimate.gszzl : detail.change);
        var typeColor = FundAPI.getTypeColor(detail.typeDesc);

        // 渲染详情头部
        detailContent.innerHTML = `
            <div class="detail-header">
                <div class="detail-title-row">
                    <span class="detail-fund-name">${detail.name}</span>
                    <span class="detail-fund-code">${fundCode}</span>
                    <span class="detail-fund-type" style="background: ${typeColor};">${detail.typeDesc}</span>
                    <button class="add-fav-btn ${isFav ? 'added' : ''}" id="detailFavBtn" data-code="${fundCode}" data-name="${detail.name}" data-type="${detail.typeDesc}" data-action="${isFav ? 'remove' : 'add'}">
                        ${isFav ? '✓ 已加自选' : '+ 加自选'}
                    </button>
                    <button class="add-fav-btn" id="detailHoldingBtn" data-code="${fundCode}" data-name="${detail.name}" data-type="${detail.typeDesc}" data-nav="${estimate ? estimate.gsz || estimate.dwjz : detail.netValue}" style="margin-left: 8px; background: linear-gradient(135deg, #13c2c2, #1677ff);">
                        💼 添加持仓
                    </button>
                </div>
                <div class="detail-metrics">
                    <div class="metric-item">
                        <div class="metric-label">单位净值</div>
                        <div class="metric-value">${FundAPI.formatNum(detail.netValue || (estimate ? estimate.dwjz : 0))}</div>
                        <div class="metric-sub">${detail.netValueDate || (estimate ? estimate.jzrq : '')}</div>
                    </div>
                    ${estimate && estimate.gsz ? `
                        <div class="metric-item">
                            <div class="metric-label">盘中估值</div>
                            <div class="metric-value ${changeClass}">${FundAPI.formatNum(estimate.gsz)}</div>
                            <div class="metric-sub ${changeClass}">${FundAPI.formatChange(estimate.gszzl)}</div>
                        </div>
                        <div class="metric-item">
                            <div class="metric-label">估值时间</div>
                            <div class="metric-value" style="font-size: 14px;">${FundAPI.formatDate(estimate.gztime, 'YYYY-MM-DD HH:mm')}</div>
                            <div class="metric-sub"><span class="pulse-dot"></span> 实时</div>
                        </div>
                    ` : ''}
                    <div class="metric-item">
                        <div class="metric-label">累计净值</div>
                        <div class="metric-value">${FundAPI.formatNum(detail.totalNetValue)}</div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-label">日涨跌幅</div>
                        <div class="metric-value ${changeClass}">${FundAPI.formatChange(estimate ? estimate.gszzl : detail.change)}</div>
                    </div>
                </div>
            </div>

            <div class="detail-body">
                <!-- 净值走势图表 -->
                <div class="detail-section">
                    <div class="detail-section-title">
                        <span>📈</span> 净值走势
                        <div class="chart-period-tabs">
                            <span class="period-tab" data-period="1m">近1月</span>
                            <span class="period-tab" data-period="3m">近3月</span>
                            <span class="period-tab active" data-period="6m">近半年</span>
                            <span class="period-tab" data-period="1y">近1年</span>
                            <span class="period-tab" data-period="all">全部</span>
                        </div>
                    </div>
                    <div class="chart-container" id="navChart"></div>
                </div>

                <!-- 基金信息 -->
                <div class="detail-section">
                    <div class="detail-section-title"><span>📋</span> 基金基础信息</div>
                    <div class="detail-info-grid">
                        <div class="info-item">
                            <span class="label">基金代码</span>
                            <span class="value">${fundCode}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">基金类型</span>
                            <span class="value">${detail.typeDesc}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">基金公司</span>
                            <span class="value">${detail.company || '--'}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">基金经理</span>
                            <span class="value">${detail.manager || (trend && trend.currentFundManager) || '--'}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">成立日期</span>
                            <span class="value">${detail.establishDate || '--'}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">基金规模</span>
                            <span class="value">${detail.scale || '--'}</span>
                        </div>
                    </div>
                </div>

                <!-- 历史净值表 -->
                <div class="detail-section">
                    <div class="detail-section-title"><span>📊</span> 历史净值</div>
                    <div class="history-table-wrap" id="historyTableWrap">
                        <div style="padding: 40px; text-align: center;">
                            <div class="loader" style="margin: 0 auto 12px;"></div>
                            <span style="color: var(--text-secondary);">加载历史净值...</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // 绑定自选按钮
        var favBtn = document.getElementById('detailFavBtn');
        if (favBtn) {
            favBtn.addEventListener('click', function () {
                handleFavToggle(this);
                var isNowFav = Store.isFavorite(fundCode);
                this.classList.toggle('added', isNowFav);
                this.dataset.action = isNowFav ? 'remove' : 'add';
                this.textContent = isNowFav ? '✓ 已加自选' : '+ 加自选';
            });
        }

        // 绑定添加持仓按钮
        var holdingBtn = document.getElementById('detailHoldingBtn');
        if (holdingBtn) {
            holdingBtn.addEventListener('click', function () {
                showHoldingForm({
                    code: this.dataset.code,
                    name: this.dataset.name,
                    type: this.dataset.type,
                    defaultPrice: this.dataset.nav
                });
            });
        }

        // 渲染图表
        if (trend && trend.netWorthTrend && trend.netWorthTrend.length > 0) {
            renderNavChart(trend, '6m');

            // 绑定周期切换
            document.querySelectorAll('.period-tab').forEach(function (tab) {
                tab.addEventListener('click', function () {
                    document.querySelectorAll('.period-tab').forEach(function (t) { t.classList.remove('active'); });
                    this.classList.add('active');
                    renderNavChart(trend, this.dataset.period);
                });
            });
        } else {
            var chartEl = document.getElementById('navChart');
            if (chartEl) {
                chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);">暂无净值走势数据</div>';
            }
        }

        // 加载历史净值表
        loadHistoryTable(fundCode);

        // 启动实时更新
        startRealtimeUpdate(fundCode);
    }

    function renderNavChart(trend, period) {
        var chartEl = document.getElementById('navChart');
        if (!chartEl) return;

        if (currentChart) {
            currentChart.dispose();
        }
        currentChart = echarts.init(chartEl);

        // 根据周期筛选数据
        var now = Date.now();
        var periodMap = {
            '1m': 30 * 24 * 3600 * 1000,
            '3m': 90 * 24 * 3600 * 1000,
            '6m': 180 * 24 * 3600 * 1000,
            '1y': 365 * 24 * 3600 * 1000,
            'all': Infinity
        };
        var cutoff = now - (periodMap[period] || periodMap['6m']);

        var data = trend.netWorthTrend.filter(function (d) {
            return d.timestamp >= cutoff;
        });

        // 如果数据太多,采样
        if (data.length > 500) {
            var step = Math.ceil(data.length / 500);
            var sampled = [];
            for (var i = 0; i < data.length; i += step) {
                sampled.push(data[i]);
            }
            data = sampled;
        }

        var xAxisData = data.map(function (d) {
            return FundAPI.formatDate(d.date, 'YYYY-MM-DD');
        });
        var seriesData = data.map(function (d) {
            return d.netValue;
        });

        // 计算涨跌区间
        var changes = data.map(function (d) { return d.change; });

        var option = {
            tooltip: {
                trigger: 'axis',
                formatter: function (params) {
                    var p = params[0];
                    var idx = p.dataIndex;
                    var change = changes[idx] || 0;
                    var changeStr = change ? ' (' + (change > 0 ? '+' : '') + change.toFixed(2) + '%)' : '';
                    return p.axisValue + '<br/>净值: ' + p.data.toFixed(4) + changeStr;
                }
            },
            grid: {
                left: '8%',
                right: '5%',
                top: '8%',
                bottom: '15%'
            },
            xAxis: {
                type: 'category',
                data: xAxisData,
                axisLabel: {
                    formatter: function (val) {
                        return val.substring(5); // 只显示 MM-DD
                    },
                    color: '#8c8c8c',
                    fontSize: 11
                },
                axisLine: { lineStyle: { color: '#f0f0f0' } }
            },
            yAxis: {
                type: 'value',
                scale: true,
                axisLabel: {
                    color: '#8c8c8c',
                    fontSize: 11,
                    formatter: function (val) {
                        return val.toFixed(4);
                    }
                },
                splitLine: { lineStyle: { color: '#f5f5f5' } }
            },
            dataZoom: [
                {
                    type: 'inside',
                    start: 0,
                    end: 100
                },
                {
                    type: 'slider',
                    start: 0,
                    end: 100,
                    height: 20,
                    bottom: 5
                }
            ],
            series: [{
                name: '单位净值',
                type: 'line',
                data: seriesData,
                smooth: true,
                symbol: 'none',
                lineStyle: {
                    width: 2,
                    color: '#1677ff'
                },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(22, 119, 255, 0.3)' },
                        { offset: 1, color: 'rgba(22, 119, 255, 0.01)' }
                    ])
                }
            }]
        };

        currentChart.setOption(option);

        // 响应式
        window.addEventListener('resize', function () {
            if (currentChart) currentChart.resize();
        });
    }

    async function loadHistoryTable(fundCode) {
        var wrap = document.getElementById('historyTableWrap');
        if (!wrap) return;

        var result = await FundAPI.getHistoryNav(fundCode, 1, 30);

        if (result.list.length === 0) {
            wrap.innerHTML = `
                <div class="empty-state" style="padding: 40px;">
                    <p>暂无历史净值数据</p>
                </div>
            `;
            return;
        }

        wrap.innerHTML = `
            <table class="fund-table" style="min-width: auto;">
                <thead>
                    <tr>
                        <th>日期</th>
                        <th class="text-right">单位净值</th>
                        <th class="text-right">累计净值</th>
                        <th class="text-right">日涨跌幅</th>
                    </tr>
                </thead>
                <tbody>
                    ${result.list.map(function (item) {
                        var changeClass = FundAPI.getChangeClass(item.change);
                        return `
                            <tr>
                                <td>${item.date}</td>
                                <td class="num-cell">${FundAPI.formatNum(item.dwjz)}</td>
                                <td class="num-cell">${FundAPI.formatNum(item.ljjz)}</td>
                                <td class="num-cell ${changeClass}">${FundAPI.formatChange(item.change)}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    }

    // 实时更新详情中的估值
    function startRealtimeUpdate(fundCode) {
        if (realtimeTimer) clearInterval(realtimeTimer);
        realtimeTimer = setInterval(async function () {
            if (!detailModal.classList.contains('active') || currentDetailCode !== fundCode) {
                clearInterval(realtimeTimer);
                return;
            }

            var est = await FundAPI.getRealtimeEstimate(fundCode);
            if (!est) return;

            // 更新估值显示
            var metrics = detailContent.querySelectorAll('.metric-item');
            if (metrics.length >= 2) {
                var estItem = metrics[1];
                var changeClass = FundAPI.getChangeClass(est.gszzl);
                var valueEl = estItem.querySelector('.metric-value');
                var subEl = estItem.querySelector('.metric-sub');
                if (valueEl) {
                    valueEl.textContent = FundAPI.formatNum(est.gsz);
                    valueEl.className = 'metric-value ' + changeClass;
                }
                if (subEl) {
                    subEl.textContent = FundAPI.formatChange(est.gszzl);
                    subEl.className = 'metric-sub ' + changeClass;
                }
            }

            // 更新日涨跌幅
            if (metrics.length >= 5) {
                var changeItem = metrics[4];
                var changeValueEl = changeItem.querySelector('.metric-value');
                if (changeValueEl) {
                    changeValueEl.textContent = FundAPI.formatChange(est.gszzl);
                    changeValueEl.className = 'metric-value ' + changeClass;
                }
            }
        }, 5000); // 每5秒更新
    }

    // ========== 自选操作 ==========
    function handleFavToggle(btn) {
        var code = btn.dataset.code;
        var name = btn.dataset.name;
        var type = btn.dataset.type;
        var action = btn.dataset.action;

        if (action === 'add') {
            var result = Store.addFavorite({ code: code, name: name, type: type });
            showToast(result.message, result.success ? 'success' : 'warning');
            if (result.success) {
                btn.dataset.action = 'remove';
                btn.textContent = '移除自选';
            }
        } else {
            Store.removeFavorite(code);
            showToast('已移除自选', 'success');
            btn.dataset.action = 'add';
            btn.textContent = '+ 自选';
        }
    }

    // ========== 搜索建议(自动补全) ==========
    async function handleSearchInput() {
        var keyword = searchInput.value.trim();
        if (keyword.length < 1) {
            searchSuggest.classList.remove('active');
            return;
        }

        clearTimeout(searchTimer);
        searchTimer = setTimeout(async function () {
            var results = await FundAPI.searchFunds(keyword);
            if (results.length === 0) {
                searchSuggest.innerHTML = '<div class="suggest-empty">未找到相关基金</div>';
            } else {
                searchSuggest.innerHTML = results.slice(0, 10).map(function (f) {
                    // 高亮匹配部分
                    var highlightedName = f.name;
                    var highlightedCode = f.code;
                    if (keyword && f.name.indexOf(keyword) !== -1) {
                        highlightedName = f.name.replace(keyword, '<strong style="color:var(--primary)">' + keyword + '</strong>');
                    }
                    if (keyword && f.code.indexOf(keyword) !== -1) {
                        highlightedCode = f.code.replace(keyword, '<strong style="color:var(--primary)">' + keyword + '</strong>');
                    }
                    return `
                        <div class="suggest-item" data-code="${f.code}" data-name="${f.name}" data-type="${f.category || f.type}">
                            <span class="suggest-code">${highlightedCode}</span>
                            <span class="suggest-name">${highlightedName}</span>
                            <span class="suggest-type">${f.category || f.type || ''}</span>
                        </div>
                    `;
                }).join('');
            }
            searchSuggest.classList.add('active');

            // 绑定点击
            searchSuggest.querySelectorAll('.suggest-item').forEach(function (item) {
                item.addEventListener('click', function () {
                    openDetail(this.dataset.code);
                    searchInput.value = '';
                    searchSuggest.classList.remove('active');
                });
            });
        }, 300);
    }

    function handleSearchSubmit() {
        var keyword = searchInput.value.trim();
        if (!keyword) {
            showToast('请输入搜索关键词', 'warning');
            return;
        }
        navigate('/search?q=' + encodeURIComponent(keyword));
        searchSuggest.classList.remove('active');
    }

    // ========== 事件绑定 ==========
    function bindEvents() {
        // 搜索输入
        searchInput.addEventListener('input', handleSearchInput);
        searchInput.addEventListener('focus', function () {
            if (searchInput.value.trim().length > 0) {
                handleSearchInput();
            }
        });
        searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                handleSearchSubmit();
            }
        });

        // 搜索按钮
        searchBtn.addEventListener('click', handleSearchSubmit);

        // 点击外部关闭搜索建议
        document.addEventListener('click', function (e) {
            if (!e.target.closest('.search-box')) {
                searchSuggest.classList.remove('active');
            }
        });

        // 关闭弹窗
        modalClose.addEventListener('click', closeModal);
        detailModal.addEventListener('click', function (e) {
            if (e.target === detailModal) closeModal();
        });

        // 持仓表单弹窗关闭
        var holdingModal = document.getElementById('holdingModal');
        var holdingModalClose = document.getElementById('holdingModalClose');
        if (holdingModalClose) {
            holdingModalClose.addEventListener('click', function () {
                holdingModal.classList.remove('active');
            });
        }
        if (holdingModal) {
            holdingModal.addEventListener('click', function (e) {
                if (e.target === holdingModal) {
                    holdingModal.classList.remove('active');
                }
            });
        }

        // ESC关闭
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (detailModal.classList.contains('active')) {
                    closeModal();
                }
                if (holdingModal && holdingModal.classList.contains('active')) {
                    holdingModal.classList.remove('active');
                }
                if (loginModal && loginModal.classList.contains('active')) {
                    loginModal.classList.remove('active');
                    stopSmsCountdown();
                }
            }
        });

        // 登录弹窗关闭
        if (loginModalClose) {
            loginModalClose.addEventListener('click', function () {
                loginModal.classList.remove('active');
                stopSmsCountdown();
            });
        }
        if (loginModal) {
            loginModal.addEventListener('click', function (e) {
                if (e.target === loginModal) {
                    loginModal.classList.remove('active');
                    stopSmsCountdown();
                }
            });
        }

        // 移动端菜单
        mobileMenuBtn.addEventListener('click', function () {
            document.querySelector('.nav-menu').classList.toggle('mobile-show');
        });

        // 路由
        window.addEventListener('hashchange', router);
    }

    function closeModal() {
        detailModal.classList.remove('active');
        if (currentChart) {
            currentChart.dispose();
            currentChart = null;
        }
        if (realtimeTimer) {
            clearInterval(realtimeTimer);
            realtimeTimer = null;
        }
        currentDetailCode = null;
    }

    // ========== 底部时间 ==========
    function updateFooterTime() {
        var el = document.getElementById('footerTime');
        if (el) {
            el.textContent = '当前时间: ' + FundAPI.formatDate(new Date(), 'YYYY-MM-DD HH:mm:ss');
        }
    }

    // ========== 邮箱验证码登录 ==========
    var codeCountdown = 0;
    var codeTimer = null;

    function getLoginState() {
        try {
            var raw = localStorage.getItem('fund_user');
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function setLoginState(user) {
        localStorage.setItem('fund_user', JSON.stringify(user));
        updateLoginUI();
    }

    function clearLoginState() {
        localStorage.removeItem('fund_user');
        updateLoginUI();
    }

    function updateLoginUI() {
        var user = getLoginState();
        var userArea = document.getElementById('userArea');
        if (!userArea) return;
        if (user && user.email) {
            userArea.innerHTML = '<span class="user-phone">' + user.email + '</span><button class="logout-btn" id="logoutBtn">退出</button>';
            var logoutBtn = document.getElementById('logoutBtn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', function () {
                    clearLoginState();
                    showToast('已退出登录', 'success');
                });
            }
        } else {
            userArea.innerHTML = '<button class="login-btn" id="loginBtn">登录</button>';
            var lb = document.getElementById('loginBtn');
            if (lb) {
                lb.addEventListener('click', function () { showLoginForm(); });
            }
        }
    }

    function showLoginForm() {
        loginFormContent.innerHTML = `
            <div class="login-header">
                <div class="login-icon">✉️</div>
                <h3>邮箱登录</h3>
                <p>验证码登录，无需注册</p>
            </div>
            <div class="login-body">
                <div class="form-group">
                    <label class="form-label">邮箱地址 <span class="required">*</span></label>
                    <input type="email" class="form-input" id="loginEmail" placeholder="请输入邮箱地址">
                </div>
                <div class="form-group">
                    <label class="form-label">验证码 <span class="required">*</span></label>
                    <div class="sms-row">
                        <input type="text" class="form-input" id="loginCode" maxlength="6" placeholder="请输入验证码">
                        <button class="sms-btn" id="smsBtn">获取验证码</button>
                    </div>
                </div>
                <div class="form-actions">
                    <button class="form-cancel" id="loginCancelBtn">取消</button>
                    <button class="form-submit" id="loginSubmitBtn">登录</button>
                </div>
                <p class="login-tip">验证码将发送至您的邮箱，5分钟内有效</p>
            </div>
        `;
        loginModal.classList.add('active');

        document.getElementById('loginCancelBtn').addEventListener('click', function () {
            loginModal.classList.remove('active');
            stopSmsCountdown();
        });

        document.getElementById('smsBtn').addEventListener('click', function () {
            sendEmailCode();
        });

        document.getElementById('loginSubmitBtn').addEventListener('click', function () {
            doLogin();
        });

        // 回车提交
        document.getElementById('loginCode').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') doLogin();
        });
        document.getElementById('loginEmail').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') document.getElementById('loginCode').focus();
        });
    }

    function sendEmailCode() {
        var email = document.getElementById('loginEmail').value.trim();
        if (!email) { showToast('请输入邮箱地址', 'warning'); return; }
        if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
            showToast('邮箱格式不正确', 'warning'); return;
        }
        if (codeCountdown > 0) return;

        var btn = document.getElementById('smsBtn');
        btn.disabled = true;
        btn.textContent = '发送中...';

        fetch('/api/auth/send-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
        }).then(function (r) { return r.json(); }).then(function (data) {
            if (data.success) {
                showToast(data.message || '验证码已发送', 'success');
                startSmsCountdown();
            } else {
                showToast(data.message || '发送失败', 'error');
                btn.disabled = false;
                btn.textContent = '获取验证码';
            }
        }).catch(function (e) {
            showToast('网络错误，请重试', 'error');
            btn.disabled = false;
            btn.textContent = '获取验证码';
        });
    }

    function startSmsCountdown() {
        codeCountdown = 60;
        var btn = document.getElementById('smsBtn');
        btn.disabled = true;
        btn.textContent = codeCountdown + 's';
        codeTimer = setInterval(function () {
            codeCountdown--;
            if (codeCountdown <= 0) {
                stopSmsCountdown();
            } else {
                btn.textContent = codeCountdown + 's';
            }
        }, 1000);
    }

    function stopSmsCountdown() {
        if (codeTimer) { clearInterval(codeTimer); codeTimer = null; }
        codeCountdown = 0;
        var btn = document.getElementById('smsBtn');
        if (btn) { btn.disabled = false; btn.textContent = '获取验证码'; }
    }

    function doLogin() {
        var email = document.getElementById('loginEmail').value.trim();
        var code = document.getElementById('loginCode').value.trim();
        if (!email) { showToast('请输入邮箱地址', 'warning'); return; }
        if (!code) { showToast('请输入验证码', 'warning'); return; }

        var btn = document.getElementById('loginSubmitBtn');
        btn.disabled = true;
        btn.textContent = '登录中...';

        fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, code: code })
        }).then(function (r) { return r.json(); }).then(function (data) {
            btn.disabled = false;
            btn.textContent = '登录';
            if (data.success) {
                setLoginState({ email: data.email, token: data.token, loginTime: Date.now() });
                showToast('登录成功', 'success');
                loginModal.classList.remove('active');
                stopSmsCountdown();
            } else {
                showToast(data.message || '登录失败', 'error');
            }
        }).catch(function (e) {
            btn.disabled = false;
            btn.textContent = '登录';
            showToast('网络错误，请重试', 'error');
        });
    }

    // ========== 初始化 ==========
    function init() {
        bindEvents();
        updateLoginUI();
        router();
        updateFooterTime();
        setInterval(updateFooterTime, 1000);
    }

    // DOM加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
