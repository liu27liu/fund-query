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
    var detailActualNavFound = false; // 详情页当日实际净值是否已出现
    var portfolioTimer = null;       // 持仓页自动刷新定时器
    var portfolioRefreshCountdown = null; // 倒计时定时器
    var portfolioSelectedCodes = []; // 持仓页选中的基金代码
    var portfolioGroupFilter = '';   // 持仓页分组筛选
    var homeRefreshTimer = null;     // 首页自动刷新定时器
    var currentRankingType = 'RZDF'; // 当前排行类型
    var currentRankingOrder = 'desc';// 当前排行排序方向
    var rankingCurrentPage = 1;      // 当前分页
    var rankingPageSize = 20;        // 每页条数
    var currentFundType = 'all';     // 当前基金类型筛选

    // ========== 站点文案配置 ==========
    var siteConfig = {};  // 从后端加载的文案配置
    function T(key, fallback) {
        return siteConfig[key] != null ? siteConfig[key] : (fallback != null ? fallback : key);
    }

    // ========== 公告栏 ==========
    var announcements = [];
    var annIndex = 0;
    var annTimer = null;

    function loadAnnouncements() {
        fetch('/api/announcements')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                announcements = data || [];
                renderAnnouncements();
            })
            .catch(function () {});
    }

    function renderAnnouncements() {
        var bar = document.getElementById('announcementBar');
        var content = document.getElementById('announcementContent');
        if (!bar || !content) return;
        if (announcements.length === 0) {
            bar.style.display = 'none';
            return;
        }
        bar.style.display = 'block';
        var typeLabels = { info: '公告', tip: '提示', warning: '注意', danger: '重要' };
        var html = '';
        announcements.forEach(function (ann, i) {
            var tagClass = 'ann-' + (ann.type || 'info');
            var tagLabel = typeLabels[ann.type] || '公告';
            var linkOpen = ann.link ? '<a href="' + escapeHtml(ann.link) + '" target="_blank" style="color:#1677ff;">' : '';
            var linkClose = ann.link ? '</a>' : '';
            html += '<div class="ann-item ' + (i === 0 ? 'active' : '') + '" data-index="' + i + '">' +
                '<span class="ann-tag ' + tagClass + '">' + tagLabel + '</span>' +
                linkOpen + escapeHtml(ann.content) + linkClose +
                '</div>';
        });
        content.innerHTML = html;
        annIndex = 0;
        // 多条公告轮播
        if (announcements.length > 1) {
            startAnnRotation();
        }
    }

    function startAnnRotation() {
        if (annTimer) clearInterval(annTimer);
        annTimer = setInterval(function () {
            var items = document.querySelectorAll('.announcement-content .ann-item');
            if (items.length <= 1) return;
            items[annIndex].classList.remove('active');
            annIndex = (annIndex + 1) % items.length;
            items[annIndex].classList.add('active');
        }, 5000);
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function loadSiteConfig(callback) {
        fetch('/api/site-config')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                siteConfig = data || {};
                applyStaticText();
                if (callback) callback();
            })
            .catch(function () { if (callback) callback(); });
    }

    // 应用静态HTML中的文案（页眉、页脚、导航等）
    function applyStaticText() {
        // 浏览器标签页标题
        document.title = T('text_page_title', '基金净值通 - 基金估值 · 股票行情 · 自选管理');
        // 页眉Logo文字
        var logoText = document.querySelector('.logo-text');
        if (logoText) logoText.textContent = T('text_header_logo', '基金股票通');
        // 搜索框占位符
        if (searchInput) searchInput.placeholder = T('text_search_placeholder', '输入基金代码 / 股票代码 / 名称 / 拼音首字母');
        // 搜索按钮
        if (searchBtn) searchBtn.textContent = T('text_search_placeholder_btn', '搜索');
        // 导航链接
        var navLinks = document.querySelectorAll('.nav-link');
        var navTexts = [
            T('text_nav_home', '首页'),
            T('text_nav_portfolio', '持仓'),
            T('text_nav_favorites', '自选'),
            T('text_nav_search', '基金列表')
        ];
        navLinks.forEach(function (link, i) {
            if (navTexts[i] != null) link.textContent = navTexts[i];
        });
        // 登录按钮
        if (loginBtn && !isLoggedIn()) loginBtn.textContent = T('text_login_btn', '登录');
        // 页脚文字
        var footerP = document.querySelector('.app-footer .footer-inner p');
        if (footerP) footerP.textContent = T('text_footer_main', '基金股票通 · 基金估值+股票行情平台');
        // SEO meta
        var metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) metaDesc.setAttribute('content', T('site_seo_description', metaDesc.getAttribute('content')));
        // 加载提示
        var loadingP = document.querySelector('.loading-screen p');
        if (loadingP) loadingP.textContent = T('text_loading_data', '正在加载数据...');
    }

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
        // 离开首页时清除自动刷新
        if (path !== '/' && path !== '') {
            stopHomeAutoRefresh();
            stopNewsAutoRefresh();
            stopMarketAutoRefresh();
        }

        // 更新导航高亮
        document.querySelectorAll('.nav-link').forEach(function (link) {
            link.classList.toggle('active', link.dataset.route === path);
        });

        // 关闭搜索建议
        searchSuggest.classList.remove('active');

        // 离开股票行情页时清除自动刷新
        if (typeof stockState !== 'undefined' && stockState.timer) { clearInterval(stockState.timer); stockState.timer = null; }

        // 路由分发
        if (path === '/' || path === '') {
            renderHome();
        } else if (path === '/search') {
            var keyword = getQueryParam(query, 'q');
            renderSearch(keyword);
        } else if (path === '/portfolio') {
            if (!isLoggedIn()) {
                showLoginRequired('持仓管理');
            } else {
                renderPortfolio();
            }
        } else if (path === '/favorites') {
            if (!isLoggedIn()) {
                showLoginRequired('自选基金');
            } else {
                renderFavorites();
            }
        } else if (path === '/fund') {
            var code = getQueryParam(query, 'code');
            if (code) openDetail(code);
        } else if (path === '/stocks') {
            renderStockMarket();
        } else if (path === '/stock') {
            var sCode = getQueryParam(query, 'code');
            var sMarket = getQueryParam(query, 'market') || '1';
            if (sCode) renderStockDetail(sMarket + '.' + sCode);
            else renderStockMarket();
        } else {
            renderHome();
        }
    }

    function showLoginRequired(featureName) {
        app.innerHTML = `
            <div class="login-required-page">
                <div class="login-required-card">
                    <div class="login-required-icon">🔒</div>
                    <h2>${featureName}需要登录</h2>
                    <p>请登录后使用${featureName}功能，您的数据将云端保存</p>
                    <button class="form-submit" id="requireLoginBtn">去登录</button>
                    <button class="form-cancel" id="requireHomeBtn">返回首页</button>
                </div>
            </div>
        `;
        document.getElementById('requireLoginBtn').addEventListener('click', function () {
            showLoginForm();
        });
        document.getElementById('requireHomeBtn').addEventListener('click', function () {
            navigate('/');
        });
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

    // ========== 折叠/展开区块 ==========
    function toggleCollapse(header) {
        var targetId = header.dataset.target;
        if (!targetId) return;
        var target = document.getElementById(targetId);
        if (!target) return;
        var icon = header.querySelector('.collapse-icon');
        var isCollapsed = header.classList.contains('collapsed');

        if (isCollapsed) {
            // 展开
            header.classList.remove('collapsed');
            target.classList.remove('collapsed-content');
            target.style.maxHeight = '';
            target.style.opacity = '';
            target.style.overflow = '';
            if (icon) icon.style.transform = 'rotate(0deg)';
        } else {
            // 折叠
            header.classList.add('collapsed');
            target.classList.add('collapsed-content');
            target.style.maxHeight = '0';
            target.style.opacity = '0';
            target.style.overflow = 'hidden';
            if (icon) icon.style.transform = 'rotate(-90deg)';
        }
    }

    // ========== 首页 ==========
    function renderHome() {
        app.innerHTML = `
            <div class="home-hero">
                <div class="hero-particles">
                    <span class="particle"></span><span class="particle"></span><span class="particle"></span>
                    <span class="particle"></span><span class="particle"></span><span class="particle"></span>
                    <span class="particle"></span><span class="particle"></span><span class="particle"></span>
                    <span class="particle"></span><span class="particle"></span><span class="particle"></span>
                </div>
                <div class="hero-orbs">
                    <div class="orb orb-1"></div>
                    <div class="orb orb-2"></div>
                    <div class="orb orb-3"></div>
                </div>
                <div class="hero-shine"></div>
                <div class="hero-content">
                    <h1 class="hero-title-anim">${T('text_hero_title', '基金股票净值通 · 实时估值查询平台')}</h1>
                    <p class="hero-subtitle-anim">${T('text_hero_subtitle', '全市场基金实时估值 · A股行情 · 主力资金流向 · 每日金句')}</p>
                    <div class="hero-stats">
                        <div class="hero-stat hero-stat-anim" style="animation-delay: 0.3s">
                            <div class="num" data-target="10000" data-suffix="+">0</div>
                            <div class="label">${T('text_hero_stat1_label', '覆盖基金')}</div>
                        </div>
                        <div class="hero-stat hero-stat-anim" style="animation-delay: 0.4s">
                            <div class="num" data-target="5540" data-suffix="+">0</div>
                            <div class="label">${T('text_hero_stat2_label', 'A股股票')}</div>
                        </div>
                        <div class="hero-stat hero-stat-anim" style="animation-delay: 0.5s">
                            <div class="num" data-target="3" data-suffix="s">0</div>
                            <div class="label">${T('text_hero_stat3_label', '估值更新')}</div>
                        </div>
                        <div class="hero-stat hero-stat-anim" style="animation-delay: 0.7s">
                            <div class="num" data-target="24" data-suffix="h">0</div>
                            <div class="label">${T('text_hero_stat4_label', '数据采集')}</div>
                        </div>
                    </div>
                </div>
                <div class="hero-quote" id="heroQuote">
                    <div class="hero-quote-text">加载中...</div>
                    <div class="hero-quote-author">— 每日语录</div>
                </div>
            </div>

            <div id="portfolioOverview"></div>

            <!-- 未登录时显示登录提示 -->
            <div id="loginPromptHome" style="display:none;"></div>

            <!-- 门户卡片网格 -->
            <div class="portal-grid">
                <div class="portal-card" data-target="marketSection">
                    <div class="portal-icon icon-blue">📈</div>
                    <div class="portal-body">
                        <div class="portal-title">${T('text_portal_market_title', '大盘指数')}</div>
                        <div class="portal-desc">${T('text_portal_market_desc', 'A股 · 美股 · 全球实时行情')}</div>
                    </div>
                    <div class="portal-arrow">›</div>
                </div>
                <div class="portal-card" data-target="stockSection">
                    <div class="portal-icon icon-red">📉</div>
                    <div class="portal-body">
                        <div class="portal-title">股票行情</div>
                        <div class="portal-desc">全市场A股 · 主力资金流向</div>
                    </div>
                    <div class="portal-arrow">›</div>
                </div>
                <div class="portal-card" data-target="sectorSection">
                    <div class="portal-icon icon-teal">🏭</div>
                    <div class="portal-body">
                        <div class="portal-title">${T('text_portal_sector_title', '行业板块')}</div>
                        <div class="portal-desc">${T('text_portal_sector_desc', '赛道行情 · 涨跌排名')}</div>
                    </div>
                    <div class="portal-arrow">›</div>
                </div>
                <div class="portal-card" data-target="rankingSection">
                    <div class="portal-icon icon-purple">📊</div>
                    <div class="portal-body">
                        <div class="portal-title">${T('text_portal_ranking_title', '基金榜单')}</div>
                        <div class="portal-desc">${T('text_portal_ranking_desc', '日涨跌 · 周涨幅 · 年涨幅')}</div>
                    </div>
                    <div class="portal-arrow">›</div>
                </div>
                <div class="portal-card" data-target="newsSection">
                    <div class="portal-icon icon-orange">📰</div>
                    <div class="portal-body">
                        <div class="portal-title">${T('text_portal_news_title', '实时资讯')}</div>
                        <div class="portal-desc">${T('text_portal_news_desc', '7×24小时财经快讯')}</div>
                    </div>
                    <div class="portal-arrow">›</div>
                </div>
            </div>

            <!-- 大盘指数 -->
            <div class="portal-section" id="marketSection" data-loaded="false">
                <div class="section-title collapsible-header" data-target="marketDashboard">
                    <span class="pulse-dot"></span>
                    ${T('text_section_market', '大盘指数实时看板')}
                    <span class="collapse-icon">▾</span>
                </div>
                <div class="market-dashboard" id="marketDashboard">
                    <div class="market-card skeleton" style="height: 90px;"></div>
                    <div class="market-card skeleton" style="height: 90px;"></div>
                    <div class="market-card skeleton" style="height: 90px;"></div>
                    <div class="market-card skeleton" style="height: 90px;"></div>
                </div>
            </div>

            <!-- 养基宝标准板块 (6大一级分类) -->
            <div class="portal-section" id="sectorSection" data-loaded="false">
                <div class="section-title collapsible-header" data-target="sectorDashboard">
                    <span class="pulse-dot"></span>
                    ${T('text_section_sector', '赛道板块实时行情')}
                    <div class="sector-filter-bar">
                        <span class="sector-tab active" data-category="行业板块">行业板块</span>
                        <span class="sector-tab" data-category="概念题材">概念题材</span>
                    </div>
                    <span class="collapse-icon">▾</span>
                </div>
                <div class="sector-dashboard" id="sectorDashboard">
                    <div class="sector-card skeleton" style="height: 72px;"></div>
                    <div class="sector-card skeleton" style="height: 72px;"></div>
                    <div class="sector-card skeleton" style="height: 72px;"></div>
                    <div class="sector-card skeleton" style="height: 72px;"></div>
                    <div class="sector-card skeleton" style="height: 72px;"></div>
                    <div class="sector-card skeleton" style="height: 72px;"></div>
                </div>
            </div>

            <!-- 基金榜单 -->
            <div class="portal-section" id="rankingSection" data-loaded="false">
                <div class="ranking-tabs-section">
                    <div class="section-title no-margin collapsible-header" data-target="rankingTable">
                        <span>📊</span>
                        ${T('text_section_ranking', '基金榜单')}
                        <span class="collapse-icon">▾</span>
                    </div>
                    <div class="ranking-tabs" id="rankingTabs">
                        <span class="ranking-tab active" data-type="RZDF" data-order="desc" data-ft="all">日涨幅榜</span>
                        <span class="ranking-tab" data-type="RZDF" data-order="asc" data-ft="all">日跌幅榜</span>
                        <span class="ranking-tab" data-type="ZZF" data-order="desc" data-ft="all">周涨幅榜</span>
                        <span class="ranking-tab" data-type="1YZF" data-order="desc" data-ft="all">月涨幅榜</span>
                        <span class="ranking-tab" data-type="1NZF" data-order="desc" data-ft="all">近1年涨幅</span>
                    </div>
                    <div class="ranking-type-filter" id="rankingTypeFilter">
                        <span class="type-tab active" data-ft="all">全部</span>
                        <span class="type-tab" data-ft="gp">股票型</span>
                        <span class="type-tab" data-ft="hh">混合型</span>
                        <span class="type-tab" data-ft="zq">债券型</span>
                        <span class="type-tab" data-ft="zs">指数型</span>
                        <span class="type-tab" data-ft="qdii">QDII</span>
                        <span class="type-tab" data-ft="fof">FOF</span>
                    </div>
                    <div class="ranking-refresh-bar">
                        <span class="refresh-info">
                            <span class="refresh-dot"></span>
                            <span id="rankingRefreshStatus">加载中...</span>
                        </span>
                    </div>
                </div>
                <div class="fund-table-wrap" id="rankingTable">
                    <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                        <div class="loader" style="margin: 0 auto 12px;"></div>
                        ${T('text_loading_ranking', '正在加载涨跌排行...')}
                    </div>
                </div>
            </div>

            <!-- 实时资讯 -->
            <div class="portal-section" id="newsSection" data-loaded="false">
                <div class="section-title collapsible-header" data-target="newsFeed">
                    <span class="pulse-dot"></span>
                    ${T('text_section_news', '7×24 实时财经资讯')}
                    <span class="collapse-icon">▾</span>
                </div>
                <div class="news-feed" id="newsFeed">
                    <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                        <div class="loader" style="margin: 0 auto 12px;"></div>
                        ${T('text_loading_news', '正在加载实时资讯...')}
                    </div>
                </div>
                <div class="news-load-more-wrap">
                    <button class="news-load-more-btn" id="newsLoadMoreBtn" style="display:none;">${T('text_load_more_news', '加载更多资讯')}</button>
                </div>
            </div>

            <!-- 股票实时行情 -->
            <div class="portal-section" id="stockSection" data-loaded="false">
                <div class="section-title collapsible-header" data-target="stockDashboard">
                    <span class="pulse-dot"></span>
                    股票实时行情
                    <span class="collapse-icon">▾</span>
                </div>
                <div class="stock-dashboard" id="stockDashboard">
                    <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                        <div class="loader" style="margin: 0 auto 12px;"></div>
                        正在加载股票行情...
                    </div>
                </div>
            </div>
        `;

        // 门户卡片点击：显示对应区块，懒加载数据
        document.querySelectorAll('.portal-card').forEach(function (card) {
            card.addEventListener('click', function () {
                var targetId = this.dataset.target;
                var target = document.getElementById(targetId);
                if (!target) return;

                // 切换卡片激活状态
                document.querySelectorAll('.portal-card').forEach(function (c) { c.classList.remove('active'); });
                this.classList.add('active');

                // 隐藏所有区块，显示目标区块
                document.querySelectorAll('.portal-section').forEach(function (s) { s.classList.remove('active'); });
                target.classList.add('active');

                // 首次显示时懒加载数据
                if (target.dataset.loaded === 'false') {
                    target.dataset.loaded = 'true';
                    if (targetId === 'marketSection') loadMarketIndices();
                    else if (targetId === 'sectorSection') loadSectors('行业板块');
                    else if (targetId === 'rankingSection') loadRanking(currentRankingType, currentRankingOrder, currentFundType);
                    else if (targetId === 'newsSection') loadNews(1);
                    else if (targetId === 'stockSection') loadHomeStockDashboard();
                }

                // 平滑滚动到区块
                var offset = 80;
                var top = target.getBoundingClientRect().top + window.pageYOffset - offset;
                window.scrollTo({ top: top, behavior: 'smooth' });
            });
        });

        // 可折叠区块标题点击
        document.querySelectorAll('.collapsible-header').forEach(function (header) {
            header.addEventListener('click', function (e) {
                if (e.target.classList.contains('sector-tab') || 
                    e.target.classList.contains('ranking-tab') ||
                    e.target.classList.contains('type-tab') ||
                    e.target.classList.contains('refresh-info') ||
                    e.target.classList.contains('refresh-dot')) return;
                toggleCollapse(this);
            });
        });

        // 板块Tab切换 (养基宝6大一级分类)
        document.querySelectorAll('.sector-tab').forEach(function (tab) {
            tab.addEventListener('click', function (e) {
                e.stopPropagation();
                document.querySelectorAll('.sector-tab').forEach(function (t) { t.classList.remove('active'); });
                this.classList.add('active');
                var category = this.dataset.category || '行业板块';
                loadSectors(category);
            });
        });

        // 排行榜Tab切换
        document.querySelectorAll('.ranking-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                document.querySelectorAll('.ranking-tab').forEach(function (t) { t.classList.remove('active'); });
                this.classList.add('active');
                currentRankingType = this.dataset.type;
                currentRankingOrder = this.dataset.order;
                rankingCurrentPage = 1; // 切换Tab时重置到第1页
                rankingCandidatePool = null; // 清除候选池,重新拉取
                var activeTypeTab = document.querySelector('.type-tab.active');
                currentFundType = activeTypeTab ? activeTypeTab.dataset.ft : 'all';
                loadRanking(currentRankingType, currentRankingOrder, currentFundType);
            });
        });

        // 基金类型筛选
        document.querySelectorAll('.type-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                document.querySelectorAll('.type-tab').forEach(function (t) { t.classList.remove('active'); });
                this.classList.add('active');
                currentFundType = this.dataset.ft;
                rankingCurrentPage = 1; // 切换类型时重置到第1页
                rankingCandidatePool = null; // 清除候选池,重新拉取
                loadRanking(currentRankingType, currentRankingOrder, currentFundType);
            });
        });

        // 加载持仓概览
        loadPortfolioOverview();
        // 加载更多资讯按钮
        var newsMoreBtn = document.getElementById('newsLoadMoreBtn');
        if (newsMoreBtn) {
            newsMoreBtn.addEventListener('click', function () {
                newsCurrentPage++;
                loadNews(newsCurrentPage, true);
            });
        }

        // 预加载所有portal区块数据(不等点击,页面加载即并行获取)
        preloadPortalSections();

        // 加载每日励志语录
        loadDailyQuote();

        // 启动首页自动刷新
        startHomeAutoRefresh();

        // Hero数字滚动动画
        animateHeroStats();

        // 启动资讯自动更新
        startNewsAutoRefresh();

        // 启动大盘指数自动刷新(独立定时器,15秒一次)
        startMarketAutoRefresh();
    }

    // 预加载所有portal区块,实现点开即显示
    function preloadPortalSections() {
        // 并行预加载4个区块的数据
        // 大盘指数
        var marketSection = document.getElementById('marketSection');
        if (marketSection && marketSection.dataset.loaded === 'false') {
            marketSection.dataset.loaded = 'true';
            loadMarketIndices();
        }
        // 行业板块
        var sectorSection = document.getElementById('sectorSection');
        if (sectorSection && sectorSection.dataset.loaded === 'false') {
            sectorSection.dataset.loaded = 'true';
            loadSectors('行业板块');
        }
        // 基金榜单
        var rankingSection = document.getElementById('rankingSection');
        if (rankingSection && rankingSection.dataset.loaded === 'false') {
            rankingSection.dataset.loaded = 'true';
            loadRanking(currentRankingType, currentRankingOrder, currentFundType);
        }
        // 实时资讯
        var newsSection = document.getElementById('newsSection');
        if (newsSection && newsSection.dataset.loaded === 'false') {
            newsSection.dataset.loaded = 'true';
            loadNews(1);
        }

        // 预加载基金列表第1页(全部类型),进入搜索页即可显示
        preloadFundList();

        // 预加载持仓数据(已登录),进入持仓页即可显示
        if (isLoggedIn()) {
            preloadPortfolioData();
        }
    }

    // 预加载基金列表第1页
    function preloadFundList() {
        var cacheKey = 'all_F009_desc_1_50_';
        if (fundListCache[cacheKey]) return; // 已缓存
        FundAPI.getFundList({
            type: 'all', sort: 'F009', order: 'desc', page: 1, size: 50, keyword: ''
        }).then(function (data) {
            fundListCache[cacheKey] = {
                funds: data.funds || [],
                total: data.total || 0,
                time: Date.now()
            };
        }).catch(function () {});
    }

    // 持仓预加载数据缓存
    var portfolioPreloadedData = null;

    // 预加载持仓数据
    function preloadPortfolioData() {
        var positions = Store.getAggregatedPositions();
        if (!positions || positions.length === 0) return;
        var codes = positions.map(function (p) { return p.code; });
        FundAPI.batchRealtimeEstimate(codes).then(function (estimates) {
            if (!estimates || estimates.length === 0) return;
            buildPortfolioNavMaps(positions, estimates).then(function (navMaps) {
                portfolioPreloadedData = {
                    positions: positions,
                    estimates: estimates,
                    navMap: navMaps.navMap,
                    changeRateMap: navMaps.changeRateMap,
                    time: Date.now()
                };
            });
        }).catch(function () {});
    }

    function animateHeroStats() {
        var nums = document.querySelectorAll('.hero-stats .num[data-target]');
        nums.forEach(function (el) {
            var target = parseInt(el.dataset.target, 10);
            var suffix = el.dataset.suffix || '';
            var duration = 1500;
            var startTime = null;

            function step(timestamp) {
                if (!startTime) startTime = timestamp;
                var progress = Math.min((timestamp - startTime) / duration, 1);
                // easeOutQuart缓动
                var eased = 1 - Math.pow(1 - progress, 4);
                var current = Math.floor(eased * target);
                el.textContent = current + suffix;
                if (progress < 1) {
                    requestAnimationFrame(step);
                } else {
                    el.textContent = target + suffix;
                }
            }
            requestAnimationFrame(step);
        });
    }

    // 加载每日励志语录
    async function loadDailyQuote() {
        var quoteEl = document.getElementById('heroQuote');
        if (!quoteEl) return;
        var data = await FundAPI.getDailyQuote();
        if (!data) return;
        var textEl = quoteEl.querySelector('.hero-quote-text');
        var authorEl = quoteEl.querySelector('.hero-quote-author');
        if (textEl) textEl.textContent = data.text;
        if (authorEl) authorEl.textContent = '— ' + data.author;
    }

    // ========== 持仓概览(首页) ==========
    async function loadPortfolioOverview() {
        var container = document.getElementById('portfolioOverview');
        if (!container) return;

        // 未登录显示登录提示
        if (!isLoggedIn()) {
            container.innerHTML = '';
            var promptEl = document.getElementById('loginPromptHome');
            if (promptEl) {
                promptEl.style.display = 'block';
                promptEl.innerHTML = `
                    <div class="login-prompt-card" style="margin-bottom: 24px; padding: 24px; text-align: center; background: var(--card-bg); border-radius: var(--radius); box-shadow: var(--card-shadow); border: 1px solid var(--border-light);">
                        <div style="font-size: 48px; margin-bottom: 12px;">🔐</div>
                        <h3 style="font-size: 18px; margin-bottom: 8px; color: var(--text);">登录后查看持仓和自选</h3>
                        <p style="font-size: 14px; color: var(--text-secondary); margin-bottom: 16px;">登录后可使用持仓盈亏追踪、自选基金管理，数据云端保存</p>
                        <button class="form-submit" onclick="document.getElementById('loginBtn').click()" style="min-width: 160px;">立即登录</button>
                    </div>
                `;
            }
            return;
        }

        // 已登录：隐藏登录提示
        var promptEl2 = document.getElementById('loginPromptHome');
        if (promptEl2) promptEl2.style.display = 'none';

        var positions = Store.getAggregatedPositions();
        if (positions.length === 0) {
            container.innerHTML = `
                <div class="portfolio-summary" style="margin-bottom: 24px;">
                    <div class="summary-header">
                        <span class="summary-title">📊 我的持仓</span>
                        <a href="#/portfolio" class="summary-link">查看详情 →</a>
                    </div>
                    <div style="padding: 32px; text-align: center; color: var(--text-tertiary);">
                        <div style="font-size: 36px; margin-bottom: 8px;">📭</div>
                        <p>暂无持仓数据，去<a href="#/portfolio" style="color: var(--primary);">添加持仓</a></p>
                    </div>
                </div>
            `;
            return;
        }

        // 获取所有持仓基金的实时估值
        var codes = positions.map(function (p) { return p.code; });
        var estimates = await FundAPI.batchRealtimeEstimate(codes);

        // 构建净值映射和日涨跌幅映射（自动检测实际净值是否已公布）
        var navMaps = await buildPortfolioNavMaps(positions, estimates);
        var navMap = navMaps.navMap;
        var changeRateMap = navMaps.changeRateMap;

        var totals = Store.calcTotalAggregatedProfit(positions, navMap, changeRateMap);
        var profitClass = totals.totalDailyProfit >= 0 ? 'profit-positive' : 'profit-negative';
        var profitSign = totals.totalDailyProfit >= 0 ? '+' : '';

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
                        <div class="summary-label">当日收益</div>
                        <div class="summary-value ${profitClass}">${profitSign}${formatMoney(totals.totalDailyProfit)}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">累计盈亏</div>
                        <div class="summary-value ${totals.totalCumulativeProfit >= 0 ? 'profit-positive' : 'profit-negative'}">${totals.totalCumulativeProfit >= 0 ? '+' : ''}${formatMoney(totals.totalCumulativeProfit)}</div>
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
                        <span class="fund-card-type" data-type="${f.type}">${f.type}</span>
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

    // ========== 赛道行业板块看板 ==========
    var allSectorsCache = []; // 缓存全部板块数据

    async function loadSectors(category) {
        var container = document.getElementById('sectorDashboard');
        if (!container) return;

        category = category || '行业板块';

        // 显示加载骨架
        container.innerHTML = '<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: var(--text-secondary);">加载中...</div>';

        var sectors = await FundAPI.getSectors(category);
        allSectorsCache = sectors;

        if (sectors.length === 0) {
            container.innerHTML = '<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: var(--text-secondary);">暂无板块数据</div>';
            return;
        }

        // 按涨跌幅降序排序
        var sorted = sectors.slice().sort(function (a, b) {
            return (b.changePercent || 0) - (a.changePercent || 0);
        });

        // 直接展示当前分类下的板块（扁平列表，不再分组）
        var html = '<div class="sector-normal-section">';
        html += sorted.map(function (s) {
            return renderSectorCard(s, false, category);
        }).join('');
        html += '</div>';

        container.innerHTML = html;

        // 点击板块查看对应基金
        container.querySelectorAll('.sector-card').forEach(function (card) {
            card.addEventListener('click', function () {
                var code = this.dataset.code;
                var name = this.dataset.name;
                if (code) {
                    showSectorFunds(code, name);
                } else {
                    searchInput.value = name;
                    navigate('/search?q=' + encodeURIComponent(name));
                }
            });
        });
    }

    function renderSectorCard(s, isHot, category) {
        var isUp = (s.changePercent || 0) >= 0;
        var colorClass = isUp ? 'sector-up' : 'sector-down';
        var sign = isUp ? '+' : '';
        var hotClass = isHot ? ' sector-hot' : '';
        // 基金类板块显示基金数量, 股票类板块显示涨跌家数
        var upDownText = '';
        if (s.fundCount !== undefined && s.fundCount > 0) {
            upDownText = s.fundCount + '只基金';
        } else if (s.upCount !== undefined && s.downCount !== undefined && (s.upCount > 0 || s.downCount > 0)) {
            upDownText = s.upCount + '/' + s.downCount;
        }
        // 货币基金显示年化收益率
        var pctText = sign + (s.changePercent || 0).toFixed(2) + '%';
        if (s.yieldType === '7日年化') {
            pctText = (s.changePercent || 0).toFixed(4) + '%';
            upDownText = '近1年年化';
        }
        // 主力净流入/流出
        var flowText = '';
        var mainFlow = s.mainFlow;
        if (mainFlow !== undefined && mainFlow !== 0) {
            var flowAbs = Math.abs(mainFlow);
            var flowUnit = '万';
            if (flowAbs >= 10000) {
                flowAbs = flowAbs / 10000;
                flowUnit = '亿';
            }
            var flowSign = mainFlow > 0 ? '+' : '-';
            var flowColor = mainFlow > 0 ? '#ef4444' : '#22c55e';
            flowText = '<span class="sector-flow" style="color:' + flowColor + ';font-size:11px;">主力' + (mainFlow > 0 ? '流入' : '流出') + ' ' + flowSign + flowAbs.toFixed(1) + flowUnit + '</span>';
        }
        return `
            <div class="sector-card ${colorClass}${hotClass}" data-code="${s.code || ''}" data-name="${s.name}">
                <div class="sector-info">
                    <span class="sector-name">${s.name}</span>
                </div>
                <div class="sector-data">
                    <span class="sector-pct">${pctText}</span>
                    ${upDownText ? '<span class="sector-updown">' + upDownText + '</span>' : ''}
                </div>
                ${flowText ? '<div class="sector-flow-row">' + flowText + '</div>' : ''}
            </div>
        `;
    }

    // ========== 板块基金弹窗 ==========
    var sectorFundsPage = 1;

    async function showSectorFunds(bkCode, sectorName) {
        sectorFundsPage = 1;
        var modal = document.getElementById('sectorFundsModal');
        var title = document.getElementById('sectorFundsTitle');
        var body = document.getElementById('sectorFundsBody');

        modal.dataset.bkCode = bkCode;
        modal.dataset.sectorName = sectorName;
        title.textContent = sectorName + ' - 相关基金';
        body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">加载中...</div>';
        modal.style.display = 'flex';

        await loadSectorFundsPage(bkCode, sectorName);
    }

    async function loadSectorFundsPage(bkCode, sectorName) {
        var body = document.getElementById('sectorFundsBody');
        var data = await FundAPI.getSectorFunds(bkCode, sectorFundsPage, 20);

        if (!data.funds || data.funds.length === 0) {
            body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">暂无相关基金数据</div>';
            return;
        }

        var html = '<div class="sector-funds-list">';
        data.funds.forEach(function (f) {
            var isUp = (f.changePercent || 0) >= 0;
            var colorClass = isUp ? 'fund-up' : 'fund-down';
            var sign = isUp ? '+' : '';
            var yearStr = f.year != null ? (f.year >= 0 ? '+' : '') + f.year.toFixed(2) + '%' : '--';
            var yearClass = f.year != null ? (f.year >= 0 ? 'fund-up' : 'fund-down') : '';
            var isFav = Store.isFavorite(f.code);
            var favAction = isFav ? 'remove' : 'add';
            var favText = isFav ? '✓' : '+';
            var favClass = isFav ? 'sf-fav-active' : 'sf-fav-add';
            html += '<div class="sector-fund-item" data-code="' + f.code + '">';
            html += '<div class="sector-fund-main">';
            html += '<span class="sector-fund-name">' + f.name + '</span>';
            html += '<span class="sector-fund-code">' + f.code + ' · ' + (f.type || '') + '</span>';
            html += '</div>';
            html += '<div class="sector-fund-data">';
            html += '<span class="sector-fund-nav">净值 ' + f.netValue.toFixed(4) + '</span>';
            html += '<span class="sector-fund-change ' + colorClass + '">' + sign + f.changePercent.toFixed(2) + '%</span>';
            html += '<span class="sector-fund-year ' + yearClass + '">近1年 ' + yearStr + '</span>';
            html += '</div>';
            html += '<div class="sf-actions">';
            html += '<button class="sf-fav-btn ' + favClass + '" data-action="' + favAction + '" data-code="' + f.code + '" data-name="' + f.name + '" data-type="' + (f.type || '') + '" title="' + (isFav ? '移除自选' : '添加自选') + '">' + favText + '</button>';
            html += '<button class="sf-detail-btn" data-code="' + f.code + '" title="查看详情">详情</button>';
            html += '</div>';
            html += '</div>';
        });
        html += '</div>';

        // 分页
        var totalPages = Math.ceil(data.total / data.size);
        if (totalPages > 1) {
            html += '<div class="sector-funds-pager">';
            if (sectorFundsPage > 1) {
                html += '<button class="sf-prev" onclick="window._sectorFundsPrev()">上一页</button>';
            }
            html += '<span class="sf-info">第 ' + sectorFundsPage + '/' + totalPages + ' 页 (共' + data.total + '只)</span>';
            if (sectorFundsPage < totalPages) {
                html += '<button class="sf-next" onclick="window._sectorFundsNext()">下一页</button>';
            }
            html += '</div>';
        }

        body.innerHTML = html;

        // 详情按钮
        body.querySelectorAll('.sf-detail-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var code = this.dataset.code;
                if (code) {
                    document.getElementById('sectorFundsModal').style.display = 'none';
                    openDetail(code);
                }
            });
        });

        // 自选按钮
        body.querySelectorAll('.sf-fav-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (!isLoggedIn()) {
                    showToast('请先登录后再添加自选', 'warning');
                    document.getElementById('loginBtn').click();
                    return;
                }
                var code = this.dataset.code;
                var name = this.dataset.name;
                var type = this.dataset.type;
                var action = this.dataset.action;
                if (action === 'add') {
                    var result = Store.addFavorite({ code: code, name: name, type: type });
                    showToast(result.message, result.success ? 'success' : 'warning');
                    if (result.success) {
                        syncToServer('favorites');
                        this.dataset.action = 'remove';
                        this.textContent = '✓';
                        this.classList.remove('sf-fav-add');
                        this.classList.add('sf-fav-active');
                        this.title = '移除自选';
                    }
                } else {
                    Store.removeFavorite(code);
                    showToast('已移除自选', 'success');
                    syncToServer('favorites');
                    this.dataset.action = 'add';
                    this.textContent = '+';
                    this.classList.remove('sf-fav-active');
                    this.classList.add('sf-fav-add');
                    this.title = '添加自选';
                }
            });
        });
    }

    window._sectorFundsPrev = function () {
        if (sectorFundsPage > 1) {
            sectorFundsPage--;
            var modal = document.getElementById('sectorFundsModal');
            var bkCode = modal.dataset.bkCode;
            var sectorName = modal.dataset.sectorName;
            if (bkCode) loadSectorFundsPage(bkCode, sectorName);
        }
    };
    window._sectorFundsNext = function () {
        sectorFundsPage++;
        var modal = document.getElementById('sectorFundsModal');
        var bkCode = modal.dataset.bkCode;
        var sectorName = modal.dataset.sectorName;
        if (bkCode) loadSectorFundsPage(bkCode, sectorName);
    };

    // ========== 大盘指数看板 ==========
    async function loadMarketIndices() {
        var container = document.getElementById('marketDashboard');
        if (!container) return;

        var indices = await FundAPI.getMarketIndices();

        if (indices.length === 0) {
            container.innerHTML = '<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: var(--text-secondary);">暂无大盘数据</div>';
            return;
        }

        container.innerHTML = indices.map(function (idx) {
            var isUp = idx.changePercent >= 0;
            var colorClass = isUp ? 'market-up' : 'market-down';
            var sign = isUp ? '+' : '';
            var arrow = isUp ? '▲' : '▼';
            var divider = '';
            if (idx.showRegion) {
                var emoji = '📊';
                if (idx.showRegion === 'A股') emoji = '🇨🇳';
                else if (idx.showRegion === '港股') emoji = '🇭🇰';
                else if (idx.showRegion === '美股') emoji = '🇺🇸';
                else if (idx.showRegion === '欧洲') emoji = '🇪🇺';
                else if (idx.showRegion === '亚太') emoji = '🌏';
                else if (idx.showRegion === '商品') emoji = '🛢️';
                divider = '<div class="market-section-divider">' + emoji + ' ' + idx.showRegion + '指数</div>';
            }
            return `
                ${divider}
                <div class="market-card ${colorClass}" data-code="${idx.code}">
                    <div class="market-name">${idx.name}</div>
                    <div class="market-price">${FundAPI.formatNum(idx.price)}</div>
                    <div class="market-change">
                        <span class="market-change-val">${sign}${FundAPI.formatNum(idx.change)}</span>
                        <span class="market-change-pct">${arrow} ${sign}${idx.changePercent.toFixed(2)}%</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ========== 大盘指数自动刷新(独立定时器,像资讯一样实时更新) ==========
    var marketAutoRefreshTimer = null;
    var MARKET_REFRESH_INTERVAL = 15; // 大盘指数刷新间隔(秒)

    function startMarketAutoRefresh() {
        stopMarketAutoRefresh();
        marketAutoRefreshTimer = setInterval(function () {
            var path = location.hash.slice(1) || '/';
            if (path !== '/' && path !== '') {
                stopMarketAutoRefresh();
                return;
            }
            // 静默刷新大盘指数(不重建DOM,只更新数值)
            silentRefreshMarketIndices();
        }, MARKET_REFRESH_INTERVAL * 1000);
    }

    function stopMarketAutoRefresh() {
        if (marketAutoRefreshTimer) { clearInterval(marketAutoRefreshTimer); marketAutoRefreshTimer = null; }
    }

    // 静默刷新:只更新已有卡片的数值和涨跌,不重建DOM(避免闪烁)
    async function silentRefreshMarketIndices() {
        var container = document.getElementById('marketDashboard');
        if (!container) return;
        var cards = container.querySelectorAll('.market-card');
        if (cards.length === 0) return;

        var indices = await FundAPI.getMarketIndices();
        if (!indices || indices.length === 0) return;

        // 构建code->data映射
        var dataMap = {};
        indices.forEach(function (idx) { dataMap[idx.code] = idx; });

        // 逐个更新所有卡片(跑马灯有两组,都要更新)
        cards.forEach(function (card) {
            var code = card.dataset.code;
            var idx = dataMap[code];
            if (!idx) return;

            var isUp = idx.changePercent >= 0;
            var sign = isUp ? '+' : '';

            // 更新颜色class(平滑切换,不闪烁)
            if (card.classList.contains('market-up') && !isUp) {
                card.classList.remove('market-up');
                card.classList.add('market-down');
            } else if (card.classList.contains('market-down') && isUp) {
                card.classList.remove('market-down');
                card.classList.add('market-up');
            } else if (!card.classList.contains('market-up') && !card.classList.contains('market-down')) {
                card.classList.add(isUp ? 'market-up' : 'market-down');
            }

            // 更新价格(仅改文本,不触动DOM结构)
            var priceEl = card.querySelector('.market-price');
            if (priceEl) priceEl.textContent = FundAPI.formatNum(idx.price);

            // 更新涨跌值和百分比
            var changeValEl = card.querySelector('.market-change-val');
            var changePctEl = card.querySelector('.market-change-pct');
            if (changeValEl) changeValEl.textContent = sign + FundAPI.formatNum(idx.change);
            if (changePctEl) {
                var arrow = isUp ? '▲' : '▼';
                changePctEl.textContent = arrow + ' ' + sign + idx.changePercent.toFixed(2) + '%';
            }
        });
    }

    // ========== 7x24实时资讯 ==========
    var newsCurrentPage = 1;
    var newsPageSize = 15;
    window._newsDataMap = window._newsDataMap || {};

    // 打开资讯全文
    window.openNewsDetail = function (idx) {
        var item = window._newsDataMap[idx];
        if (!item) return;
        // 直接显示完整内容，不用iframe(新闻网站会阻止嵌入)
        var overlay = document.createElement('div');
        overlay.className = 'news-detail-overlay';
        overlay.onclick = function (e) {
            if (e.target === overlay) closeNewsDetail();
        };
        overlay.innerHTML =
            '<div class="news-detail-modal">' +
            '  <div class="news-detail-header">' +
            '    <div class="news-detail-title-text">' + (item.title || '') + '</div>' +
            '    <button class="news-detail-close" onclick="closeNewsDetail()">&times;</button>' +
            '  </div>' +
            '  <div class="news-detail-body">' +
            '    <div class="news-detail-meta">' +
            '      <span class="news-detail-source">' + (item.source || '') + '</span>' +
            '      <span class="news-detail-time">' + (item.time || '') + '</span>' +
            '    </div>' +
            '    <div class="news-detail-content">' + (item.summary || '暂无详细内容') + '</div>' +
            (item.url ? '<div class="news-detail-link"><a href="' + item.url + '" target="_blank" rel="noopener">在原文中阅读 ›</a></div>' : '') +
            '  </div>' +
            '</div>';
        document.body.appendChild(overlay);
        requestAnimationFrame(function () { overlay.classList.add('active'); });
        document.body.style.overflow = 'hidden';
    };

    window.closeNewsDetail = function () {
        var overlay = document.querySelector('.news-detail-overlay');
        if (!overlay) return;
        overlay.classList.remove('active');
        setTimeout(function () {
            overlay.remove();
            document.body.style.overflow = '';
        }, 300);
    };

    async function loadNews(page, isLoadMore) {
        var container = document.getElementById('newsFeed');
        if (!container) return;

        // 第一页时重置分页游标
        if (page === 1) {
            FundAPI.resetNewsCursor();
        }

        if (!isLoadMore) {
            container.innerHTML = `
                <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                    <div class="loader" style="margin: 0 auto 12px;"></div>
                    正在加载实时资讯...
                </div>
            `;
        }

        var news = await FundAPI.getNews(page, newsPageSize);

        if (news.length === 0) {
            if (!isLoadMore) {
                container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">暂无资讯</div>';
            }
            var moreBtn = document.getElementById('newsLoadMoreBtn');
            if (moreBtn) moreBtn.style.display = 'none';
            return;
        }

        var newsHtml = news.map(function (item, idx) {
            var time = item.time || '';
            // 提取时分
            var timeShort = time;
            if (time.length > 5) {
                var match = time.match(/(\d{2}:\d{2})/);
                if (match) timeShort = match[1];
            }
            var newsUrl = item.url || '';
            var onclickAttr = newsUrl ? ' onclick="openNewsDetail(' + idx + ')"' : '';
            return `
                <div class="news-item"${onclickAttr} data-idx="${idx}">
                    <div class="news-time">${timeShort}</div>
                    <div class="news-content">
                        <div class="news-title">${item.title}</div>
                        <div class="news-summary">${item.summary || ''}</div>
                        <div class="news-meta">
                            <span class="news-full-time">${time}</span>
                            ${newsUrl ? '<span class="news-read-more">点击阅读全文 ›</span>' : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // 存储新闻URL映射
        window._newsDataMap = window._newsDataMap || {};
        news.forEach(function (item, idx) {
            window._newsDataMap[idx] = item;
        });

        if (isLoadMore) {
            container.insertAdjacentHTML('beforeend', newsHtml);
        } else {
            container.innerHTML = newsHtml;
        }

        // 显示加载更多按钮
        var moreBtn = document.getElementById('newsLoadMoreBtn');
        if (moreBtn && news.length >= newsPageSize) {
            moreBtn.style.display = 'inline-block';
        } else if (moreBtn) {
            moreBtn.style.display = 'none';
        }

        // 检查新资讯并插入动画
        if (!isLoadMore && news.length > 0) {
            highlightNewNews(container);
        }
    }

    // 资讯自动更新定时器
    var newsAutoRefreshTimer = null;
    var NEWS_REFRESH_INTERVAL = 30; // 资讯自动刷新间隔(秒)
    var lastNewsFirstId = null; // 记录上次第一条资讯的唯一标识

    function startNewsAutoRefresh() {
        stopNewsAutoRefresh();
        newsAutoRefreshTimer = setInterval(function () {
            var path = location.hash.slice(1) || '/';
            if (path !== '/' && path !== '') {
                stopNewsAutoRefresh();
                return;
            }
            // 静默刷新资讯(不显示loading)
            silentRefreshNews();
        }, NEWS_REFRESH_INTERVAL * 1000);
    }

    function stopNewsAutoRefresh() {
        if (newsAutoRefreshTimer) { clearInterval(newsAutoRefreshTimer); newsAutoRefreshTimer = null; }
    }

    // 静默刷新:获取最新资讯,有新内容则插入到顶部
    async function silentRefreshNews() {
        var container = document.getElementById('newsFeed');
        if (!container) return;

        // 记录当前第一条资讯的时间(用于判断是否有新资讯)
        var firstItem = container.querySelector('.news-item');
        if (firstItem) {
            var fullTime = firstItem.querySelector('.news-full-time');
            if (fullTime) {
                lastNewsFirstId = fullTime.textContent.trim();
            }
        }

        FundAPI.resetNewsCursor();
        var news = await FundAPI.getNews(1, newsPageSize);
        if (!news || news.length === 0) return;

        // 检查是否有新资讯
        var hasNew = false;
        var newItems = [];
        for (var i = 0; i < news.length; i++) {
            var itemTime = news[i].time || '';
            if (itemTime === lastNewsFirstId) break;
            hasNew = true;
            newItems.push(news[i]);
        }

        if (hasNew && newItems.length > 0) {
            // 构建新资讯HTML
            var newHtml = newItems.map(function (item) {
                var time = item.time || '';
                var timeShort = time;
                if (time.length > 5) {
                    var match = time.match(/(\d{2}:\d{2})/);
                    if (match) timeShort = match[1];
                }
                var newsUrl = item.url || '';
                var globalIdx = Object.keys(window._newsDataMap).length + i;
                window._newsDataMap[globalIdx] = item;
                var clickHtml = newsUrl ? ' onclick="openNewsDetail(' + globalIdx + ')"' : '';
                var readMoreHtml = newsUrl ? '<span class="news-read-more">点击阅读全文 ›</span>' : '';
                return '<div class="news-item news-item-new"' + clickHtml + ' data-idx="' + globalIdx + '">' +
                    '<div class="news-time">' + timeShort + '</div>' +
                    '<div class="news-content">' +
                    '<div class="news-title">' + item.title + '</div>' +
                    '<div class="news-summary">' + (item.summary || '') + '</div>' +
                    '<div class="news-meta"><span class="news-full-time">' + time + '</span>' + readMoreHtml + '</div>' +
                    '</div></div>';
            }).join('');

            // 插入到顶部
            container.insertAdjacentHTML('afterbegin', newHtml);

            // 限制总条数,移除超出部分(保留最多50条)
            var allItems = container.querySelectorAll('.news-item');
            if (allItems.length > 50) {
                for (var j = 50; j < allItems.length; j++) {
                    allItems[j].remove();
                }
            }

            // 更新第一条标识
            var newFirst = container.querySelector('.news-full-time');
            if (newFirst) lastNewsFirstId = newFirst.textContent.trim();
        }

        FundAPI.resetNewsCursor();
    }

    // 高亮新资讯动画
    function highlightNewNews(container) {
        var newItems = container.querySelectorAll('.news-item-new');
        newItems.forEach(function (item, index) {
            item.style.animationDelay = (index * 0.1) + 's';
        });
    }

    var rankingRefreshTimer = null;
    var rankingRequestId = 0;
    // 多Key缓存:每个sortType+order+fundType组合独立缓存
    var dailyRankingCacheMap = {};  // {key: {ranking, totalCount, totalPages, actualNavPublished, time}}
    // 实时排名候选池:拉取500只候选,获取实时估值后重排序,支持分页
    var rankingCandidatePool = null;  // {sortType, order, fundType, candidates, total, time}

    function getRankingCacheKey(sortType, order, fundType) {
        return sortType + '_' + order + '_' + fundType;
    }

    async function loadRanking(sortType, order, fundType) {
        sortType = sortType || currentRankingType;
        order = order || currentRankingOrder;
        fundType = fundType || currentFundType;
        var container = document.getElementById('rankingTable');
        if (!container) return;

        var myRequestId = ++rankingRequestId;
        if (rankingRefreshTimer) { clearInterval(rankingRefreshTimer); rankingRefreshTimer = null; }

        var page = rankingCurrentPage;
        var isDaily = (sortType === 'RZDF');
        var cacheKey = getRankingCacheKey(sortType, order, fundType) + '_p' + page;

        // 优先显示已有缓存数据(立即显示,不等加载)
        if (dailyRankingCacheMap[cacheKey]) {
            var cachedData = dailyRankingCacheMap[cacheKey];
            renderRankingPage(container, cachedData, page, sortType, order, fundType, myRequestId);
            // 缓存超过30秒才后台刷新,否则直接用缓存
            if (Date.now() - cachedData.time < 30000) {
                return;
            }
        } else if (page === 1) {
            container.innerHTML = `
                <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                    <div class="loader" style="margin: 0 auto 12px;"></div>
                    正在从全市场基金中筛选${order === 'desc' ? '涨幅' : '跌幅'}数据...
                </div>
            `;
        }

        if (isDaily) {
            // ===== 日涨跌榜：全市场实时排名(服务端排序+缓存) =====
            if (page === 1) {
                container.innerHTML = `
                    <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                        <div class="loader" style="margin: 0 auto 12px;"></div>
                        正在全市场基金中计算实时涨跌排名(首次加载较慢,后续秒级响应)...
                    </div>
                `;
            }

            // 调用服务端实时排名API(服务端拉取全市场+并发获取估值+排序+缓存90秒)
            var rtData = await FundAPI.getRealtimeRanking(order, fundType, page, rankingPageSize);

            if (myRequestId !== rankingRequestId) return;

            if (!rtData.funds || rtData.funds.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="icon">📊</div>
                        <h3>暂无排行数据</h3>
                        <p>数据接口可能暂时不可用,请稍后重试</p>
                    </div>
                `;
                updateRankingRefreshStatus(false);
                return;
            }

            // 写入分页缓存
            dailyRankingCacheMap[cacheKey] = {
                ranking: rtData.funds,
                totalCount: rtData.total,
                totalPages: rtData.totalPages,
                actualNavPublished: false,
                time: Date.now()
            };

            // 渲染
            var cached = dailyRankingCacheMap[cacheKey];
            if (cached) {
                renderRankingPage(container, cached, page, sortType, order, fundType, myRequestId);
            }
            return;
        }

        // 非日榜(周/月/年榜)走原有逻辑
        // ===== 周/月/年榜：直接使用API数据，服务端分页 =====
        var rankingData = await Promise.race([
            FundAPI.getFundRankingWithTotal(sortType, rankingPageSize, order, fundType, page),
            new Promise(function (resolve) { setTimeout(function () { resolve({ funds: [], total: 0 }); }, 15000); })
        ]);
        var candidates = rankingData.funds || [];
        var totalCount = rankingData.total || candidates.length;

        if (!candidates || candidates.length === 0) {
            if (myRequestId !== rankingRequestId) return;
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">📊</div>
                    <h3>暂无排行数据</h3>
                    <p>数据接口可能暂时不可用,请稍后重试</p>
                </div>
            `;
            updateRankingRefreshStatus(false);
            return;
        }

        var ranking = candidates.map(function (f) {
            f.realtimeChange = null;
            f.hasRealtime = false;
            return f;
        });

        var changeColTitle = sortType === 'ZZF' ? '周涨幅' : (sortType === '1YZF' ? '近1月涨幅' : (sortType === '1NZF' ? '近1年涨幅' : '日涨跌幅'));
        var totalPages = Math.ceil(totalCount / rankingPageSize);
        var startRank = (page - 1) * rankingPageSize;

        container.innerHTML = `
            <div class="ranking-info-bar">
                <span>实时排名前 <strong>${totalCount}</strong> 只基金，第 ${page}/${totalPages} 页（${changeColTitle}排序）</span>
            </div>
            <div class="ranking-table-fixed">
                <table class="fund-table">
                    <thead>
                        <tr>
                            <th>基金名称</th>
                            <th class="text-right">最新净值</th>
                            <th class="text-right">${changeColTitle}</th>
                            <th class="text-right">操作</th>
                        </tr>
                    </thead>
                    <tbody id="rankingTbody">
                        ${ranking.map(function (f, i) {
                            var change = f.change;
                            var changeClass = FundAPI.getChangeClass(change);
                            var isFav = Store.isFavorite(f.code);
                            return `
                                <tr data-code="${f.code}" data-rank="${i}" style="transition: all 0.5s ease;">
                                    <td class="col-name">
                                        <div class="fund-name-cell">
                                            <span class="name">${startRank + i + 1}. ${f.name}</span>
                                            <span class="code">${f.code} · ${f.type}</span>
                                        </div>
                                    </td>
                                    <td class="num-cell net-value-cell">${FundAPI.formatNum(f.netValue)}</td>
                                    <td class="num-cell change-cell">
                                        <span class="change-badge ${changeClass === 'up' ? 'bg-up' : changeClass === 'down' ? 'bg-down' : 'bg-flat'}">
                                            ${FundAPI.formatChange(change)}
                                        </span>
                                    </td>
                                    <td class="action-cell">
                                        <button class="action-btn ${isFav ? '' : 'add-fav-mini'}" data-action="${isFav ? 'remove' : 'add'}" data-code="${f.code}" data-name="${f.name}" data-type="${f.type}">
                                            ${isFav ? '移除自选' : '+ 自选'}
                                        </button>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            ${totalPages > 1 ? `
                <div class="ranking-pagination">
                    <button class="page-btn" data-page="1" ${page <= 1 ? 'disabled' : ''}>首页</button>
                    <button class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
                    <span class="page-info">第 <strong>${page}</strong> / ${totalPages} 页</span>
                    <button class="page-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>下一页</button>
                    <button class="page-btn" data-page="${totalPages}" ${page >= totalPages ? 'disabled' : ''}>末页</button>
                </div>
            ` : ''}
        `;

        // 绑定行点击和自选事件
        bindRankingEvents(container, sortType, order, fundType, isDaily);
        updateRankingRefreshStatus(true);

        // 自动刷新：周/月/年榜24小时
        rankingRefreshTimer = setInterval(function () {
            if (document.getElementById('rankingTable')) {
                loadRanking(sortType, order, fundType);
            }
        }, 24 * 60 * 60 * 1000);
    }

    // 渲染日榜分页数据(从缓存)
    function renderRankingPage(container, cached, page, sortType, order, fundType, myRequestId) {
        if (myRequestId !== rankingRequestId) return;

        // 缓存只存当前页数据(服务端分页),直接使用,不需slice
        var pageData = cached.ranking;

        if (!pageData || pageData.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="icon">📊</div><h3>没有更多数据</h3></div>';
            return;
        }

        var changeColTitle = cached.actualNavPublished ? '今日涨跌幅' : '今日实时涨跌幅';
        var totalPages = cached.totalPages;
        var totalCount = cached.totalCount;
        var startRank = (page - 1) * rankingPageSize;

        container.innerHTML = `
            <div class="ranking-info-bar">
                <span>实时排名前 <strong>${totalCount}</strong> 只基金，第 ${page}/${totalPages} 页（${changeColTitle}排序）</span>
            </div>
            <div class="ranking-table-fixed">
                <table class="fund-table">
                    <thead>
                        <tr>
                            <th>基金名称</th>
                            <th class="text-right">${cached.actualNavPublished ? '最新净值' : '今日实时估值'}</th>
                            <th class="text-right">${changeColTitle}</th>
                            <th class="text-right">操作</th>
                        </tr>
                    </thead>
                    <tbody id="rankingTbody">
                        ${pageData.map(function (f, i) {
                            var change = f.realtimeChange !== null ? f.realtimeChange : f.change;
                            var changeClass = FundAPI.getChangeClass(change);
                            var isFav = Store.isFavorite(f.code);
                            return `
                                <tr data-code="${f.code}" data-rank="${i}" style="transition: all 0.5s ease;">
                                    <td class="col-name">
                                        <div class="fund-name-cell">
                                            <span class="name">${startRank + i + 1}. ${f.name}</span>
                                            <span class="code">${f.code} · ${f.type}</span>
                                        </div>
                                    </td>
                                    <td class="num-cell net-value-cell">${FundAPI.formatNum(f.netValue)}</td>
                                    <td class="num-cell change-cell">
                                        <span class="change-badge ${changeClass === 'up' ? 'bg-up' : changeClass === 'down' ? 'bg-down' : 'bg-flat'}">
                                            ${FundAPI.formatChange(change)}
                                        </span>
                                    </td>
                                    <td class="action-cell">
                                        <button class="action-btn ${isFav ? '' : 'add-fav-mini'}" data-action="${isFav ? 'remove' : 'add'}" data-code="${f.code}" data-name="${f.name}" data-type="${f.type}">
                                            ${isFav ? '移除自选' : '+ 自选'}
                                        </button>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            ${totalPages > 1 ? `
                <div class="ranking-pagination">
                    <button class="page-btn" data-page="1" ${page <= 1 ? 'disabled' : ''}>首页</button>
                    <button class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
                    <span class="page-info">第 <strong>${page}</strong> / ${totalPages} 页</span>
                    <button class="page-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>下一页</button>
                    <button class="page-btn" data-page="${totalPages}" ${page >= totalPages ? 'disabled' : ''}>末页</button>
                </div>
            ` : ''}
        `;

        bindRankingEvents(container, sortType, order, fundType, true);
        updateRankingRefreshStatus(true);

        // 日榜自动刷新15分钟
        if (rankingRefreshTimer) { clearInterval(rankingRefreshTimer); rankingRefreshTimer = null; }
        rankingRefreshTimer = setInterval(function () {
            if (document.getElementById('rankingTable')) {
                // 清缓存以重新获取实时数据
                rankingCandidatePool = null;
                delete dailyRankingCacheMap[getRankingCacheKey(sortType, order, fundType)];
                loadRanking(sortType, order, fundType);
            }
        }, 15 * 60 * 1000);
    }

    // 绑定榜单事件(行点击/自选/分页)
    function bindRankingEvents(container, sortType, order, fundType, isDaily) {
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
        container.querySelectorAll('.page-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (this.disabled) return;
                rankingCurrentPage = parseInt(this.dataset.page);
                loadRanking(sortType, order, fundType);
                container.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    // ========== 搜索页 ==========
    // 搜索页状态
    var searchState = {
        type: 'all',
        sort: 'quarter',
        order: 'desc',
        page: 1,
        size: 50,
        keyword: '',
        total: 0,
        loading: false
    };

    function renderSearch(keyword) {
        searchState.keyword = keyword || '';
        searchState.page = 1;

        var typeTabs = [
            { key: 'all', label: '全部' },
            { key: 'gpx', label: '股票型' },
            { key: 'hhx', label: '混合型' },
            { key: 'zqx', label: '债券型' },
            { key: 'QDII', label: 'QDII' },
            { key: 'zsx', label: '指数型' }
        ];

        app.innerHTML = `
            <div class="search-page">
                <div class="search-results-header">
                    <h2>基金列表</h2>
                    <p id="searchResultCount">${keyword ? '关键词: "' + keyword + '" · ' : ''}正在加载...</p>
                </div>

                <div class="fund-type-tabs">
                    ${typeTabs.map(function (t) {
                        return '<span class="fund-type-tab' + (t.key === searchState.type ? ' active' : '') + '" data-type="' + t.key + '">' + t.label + '</span>';
                    }).join('')}
                </div>

                <div class="fund-table-wrap" id="searchResultTable">
                    <div style="padding: 40px; text-align: center;">
                        <div class="loader" style="margin: 0 auto 12px;"></div>
                        <p style="color: var(--text-secondary);">正在加载基金列表...</p>
                    </div>
                </div>

                <div class="pagination" id="searchPagination"></div>
            </div>
        `;

        // 绑定类型Tab
        app.querySelectorAll('.fund-type-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                app.querySelectorAll('.fund-type-tab').forEach(function (t) { t.classList.remove('active'); });
                this.classList.add('active');
                searchState.type = this.dataset.type;
                searchState.page = 1;
                loadFundList();
            });
        });

        loadFundList();
    }

    // 基金列表分页缓存: key = type_sort_order_page_size_keyword
    var fundListCache = {};

    async function loadFundList() {
        if (searchState.loading) return;
        searchState.loading = true;

        var cacheKey = searchState.type + '_' + searchState.sort + '_' + searchState.order + '_' + searchState.page + '_' + searchState.size + '_' + (searchState.keyword || '');

        // 优先从缓存显示(立即渲染,无loading)
        if (fundListCache[cacheKey]) {
            var cached = fundListCache[cacheKey];
            searchState.total = cached.total;
            renderFundListTable(cached.funds);
            renderPagination();
            searchState.loading = false;
            // 缓存超过2分钟才刷新,否则直接用缓存
            if (Date.now() - cached.time < 120000) return;
            // 超过2分钟,后台静默刷新(不显示loading)
            searchState.loading = false;
            silentRefreshFundList(cacheKey);
            return;
        }

        var container = document.getElementById('searchResultTable');
        if (container) {
            container.innerHTML = '<div style="padding: 40px; text-align: center;"><div class="loader" style="margin: 0 auto 12px;"></div><p style="color: var(--text-secondary);">正在加载...</p></div>';
        }

        try {
            var data = await FundAPI.getFundList({
                type: searchState.type,
                sort: searchState.sort,
                order: searchState.order,
                page: searchState.page,
                size: searchState.size,
                keyword: searchState.keyword
            });

            searchState.total = data.total || 0;
            renderFundListTable(data.funds || []);
            renderPagination();

            // 写入缓存
            fundListCache[cacheKey] = {
                funds: data.funds || [],
                total: searchState.total,
                time: Date.now()
            };
        } catch (e) {
            console.warn('加载基金列表失败:', e);
            if (container) {
                container.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><h3>加载失败</h3><p>请稍后重试</p></div>';
            }
        } finally {
            searchState.loading = false;
        }
    }

    // 静默刷新基金列表(不显示loading)
    async function silentRefreshFundList(cacheKey) {
        try {
            var data = await FundAPI.getFundList({
                type: searchState.type,
                sort: searchState.sort,
                order: searchState.order,
                page: searchState.page,
                size: searchState.size,
                keyword: searchState.keyword
            });
            searchState.total = data.total || 0;
            fundListCache[cacheKey] = {
                funds: data.funds || [],
                total: searchState.total,
                time: Date.now()
            };
            // 仅当用户还在当前页时更新DOM
            var currentKey = searchState.type + '_' + searchState.sort + '_' + searchState.order + '_' + searchState.page + '_' + searchState.size + '_' + (searchState.keyword || '');
            if (currentKey === cacheKey) {
                renderFundListTable(data.funds || []);
                renderPagination();
            }
        } catch (e) { /* 静默失败 */ }
    }

    function renderFundListTable(funds) {
        var container = document.getElementById('searchResultTable');
        if (!container) return;

        // 更新结果计数
        var countEl = document.getElementById('searchResultCount');
        if (countEl) {
            countEl.textContent = (searchState.keyword ? '关键词: "' + searchState.keyword + '" · ' : '') + '共 ' + searchState.total + ' 只基金';
        }

        if (funds.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">🔍</div>
                    <h3>未找到相关基金</h3>
                    <p>试试其他关键词或切换基金类型</p>
                </div>
            `;
            return;
        }

        var sortArrow = function (field) {
            if (searchState.sort !== field) return '';
            return searchState.order === 'desc' ? ' ▼' : ' ▲';
        };

        container.innerHTML = `
            <table class="fund-list-table">
                <thead>
                    <tr>
                        <th class="sortable" data-sort="code">代码${sortArrow('code')}</th>
                        <th>名称</th>
                        <th class="text-right sortable" data-sort="net">净值${sortArrow('net')}</th>
                        <th class="text-right sortable" data-sort="totalnet">累计净值${sortArrow('totalnet')}</th>
                        <th class="text-center sortable" data-sort="date">更新日期${sortArrow('date')}</th>
                        <th class="text-right sortable" data-sort="daily">日增长率${sortArrow('daily')}</th>
                        <th class="text-right sortable" data-sort="week">近一周${sortArrow('week')}</th>
                        <th class="text-right sortable" data-sort="month">近一月${sortArrow('month')}</th>
                        <th class="text-right sortable" data-sort="quarter">近三月${sortArrow('quarter')}</th>
                        <th class="text-right sortable" data-sort="year">近一年${sortArrow('year')}</th>
                        <th class="text-right sortable" data-sort="since">成立以来${sortArrow('since')}</th>
                        <th class="text-right">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${funds.map(function (f) {
                        var dailyClass = FundAPI.getChangeClass(parseFloat(f.daily) || 0);
                        var weekClass = FundAPI.getChangeClass(parseFloat(f.week) || 0);
                        var monthClass = FundAPI.getChangeClass(parseFloat(f.month) || 0);
                        var quarterClass = FundAPI.getChangeClass(parseFloat(f.quarter) || 0);
                        var yearClass = FundAPI.getChangeClass(parseFloat(f.year) || 0);
                        var sinceClass = FundAPI.getChangeClass(parseFloat(f.since) || 0);
                        var isFav = Store.isFavorite(f.code);
                        var fmtPct = function (v) {
                            var n = parseFloat(v);
                            if (isNaN(n)) return '--';
                            return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
                        };
                        var fmtNum = function (v) {
                            var n = parseFloat(v);
                            if (isNaN(n)) return '--';
                            return n.toFixed(4);
                        };
                        return `
                            <tr data-code="${f.code}">
                                <td class="col-code">${f.code}</td>
                                <td class="col-name">
                                    <div class="fund-name-cell">
                                        <span class="name">${f.name}</span>
                                        <span class="code">${f.typename || f.type || ''}</span>
                                    </div>
                                </td>
                                <td class="num-cell">${fmtNum(f.net)}</td>
                                <td class="num-cell">${fmtNum(f.totalnet)}</td>
                                <td class="text-center">${f.date || '--'}</td>
                                <td class="num-cell ${dailyClass === 'up' ? 'text-up' : dailyClass === 'down' ? 'text-down' : ''}">${fmtPct(f.daily)}</td>
                                <td class="num-cell ${weekClass === 'up' ? 'text-up' : weekClass === 'down' ? 'text-down' : ''}">${fmtPct(f.week)}</td>
                                <td class="num-cell ${monthClass === 'up' ? 'text-up' : monthClass === 'down' ? 'text-down' : ''}">${fmtPct(f.month)}</td>
                                <td class="num-cell ${quarterClass === 'up' ? 'text-up' : quarterClass === 'down' ? 'text-down' : ''}">${fmtPct(f.quarter)}</td>
                                <td class="num-cell ${yearClass === 'up' ? 'text-up' : yearClass === 'down' ? 'text-down' : ''}">${fmtPct(f.year)}</td>
                                <td class="num-cell ${sinceClass === 'up' ? 'text-up' : sinceClass === 'down' ? 'text-down' : ''}">${fmtPct(f.since)}</td>
                                <td>
                                    <button class="action-btn ${isFav ? 'fav-active' : ''}" data-action="${isFav ? 'remove' : 'add'}" data-code="${f.code}" data-name="${f.name}" data-type="${f.typename || f.type}">
                                        ${isFav ? '移除' : '+ 自选'}
                                    </button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;

        // 绑定行点击
        container.querySelectorAll('tr[data-code]').forEach(function (tr) {
            tr.addEventListener('click', function (e) {
                if (e.target.classList.contains('action-btn')) return;
                openDetail(this.dataset.code);
            });
        });

        // 绑定排序
        container.querySelectorAll('.sortable').forEach(function (th) {
            th.style.cursor = 'pointer';
            th.addEventListener('click', function () {
                var field = this.dataset.sort;
                if (searchState.sort === field) {
                    searchState.order = searchState.order === 'desc' ? 'asc' : 'desc';
                } else {
                    searchState.sort = field;
                    searchState.order = 'desc';
                }
                searchState.page = 1;
                loadFundList();
            });
        });

        // 绑定自选按钮
        container.querySelectorAll('.action-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                handleFavToggle(this);
            });
        });
    }

    function renderPagination() {
        var pagEl = document.getElementById('searchPagination');
        if (!pagEl) return;

        var totalPages = Math.ceil(searchState.total / searchState.size);
        if (totalPages <= 1) {
            pagEl.innerHTML = '';
            return;
        }

        var currentPage = searchState.page;
        var html = '';

        // 上一页
        if (currentPage > 1) {
            html += '<span class="page-btn" data-page="' + (currentPage - 1) + '">‹ 上一页</span>';
        }

        // 页码
        var startPage = Math.max(1, currentPage - 2);
        var endPage = Math.min(totalPages, currentPage + 2);
        if (startPage > 1) {
            html += '<span class="page-btn" data-page="1">1</span>';
            if (startPage > 2) html += '<span class="page-ellipsis">...</span>';
        }
        for (var i = startPage; i <= endPage; i++) {
            html += '<span class="page-btn' + (i === currentPage ? ' active' : '') + '" data-page="' + i + '">' + i + '</span>';
        }
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) html += '<span class="page-ellipsis">...</span>';
            html += '<span class="page-btn" data-page="' + totalPages + '">' + totalPages + '</span>';
        }

        // 下一页
        if (currentPage < totalPages) {
            html += '<span class="page-btn" data-page="' + (currentPage + 1) + '">下一页 ›</span>';
        }

        pagEl.innerHTML = html;

        pagEl.querySelectorAll('.page-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                searchState.page = parseInt(this.dataset.page);
                loadFundList();
                // 滚动到顶部
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });
    }

    // ========== 持仓页 ==========
    var portfolioExpandedGroups = {}; // 记录哪些分组展开着

    // 构建持仓净值映射和涨跌幅映射
    // 检查历史净值表首行是否为当日实际净值，是则用实际值，否则用盘中估值
    async function buildPortfolioNavMaps(positions, estimates) {
        var navMap = {};
        var changeRateMap = {};

        // 获取当日日期（优先从估值的gztime取，保证与服务端一致）
        var todayStr = '';
        if (estimates && estimates.length > 0 && estimates[0].gztime) {
            todayStr = estimates[0].gztime.substring(0, 10);
        }
        if (!todayStr) {
            var now = new Date();
            todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        }

        // 先用估值填充默认值
        positions.forEach(function (p) {
            var est = estimates ? estimates.find(function (e) { return e.fundcode === p.code; }) : null;
            if (est) {
                navMap[p.code] = est.gsz || est.dwjz || p.costPrice;
                changeRateMap[p.code] = est.gszzl || 0;
            } else {
                // 无估值:已清仓用0,未清仓用成本价
                navMap[p.code] = (p.currentShares || 0) <= 0.0001 ? 0 : p.costPrice;
                changeRateMap[p.code] = 0;
            }
        });

        // 不再同步等待历史净值检查(这是加载慢的主要原因)
        // 盘中用估值即可,收盘后估值API的dwjz会更新为实际净值
        return { navMap: navMap, changeRateMap: changeRateMap };
    }

    function renderPortfolio() {
        if (!isLoggedIn()) {
            showLoginRequired('持仓');
            return;
        }

        var positions = Store.getAggregatedPositions();
        var groups = Store.getPortfolioGroups();
        portfolioSelectedCodes = [];

        app.innerHTML = `
            <div class="favorites-header">
                <h2 style="font-size: 20px;">💼 我的持仓</h2>
                <div class="portfolio-toolbar">
                    <button class="refresh-btn" id="manualRefreshBtn" title="手动刷新">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
                        刷新
                    </button>
                </div>
                <button class="add-holding-btn" id="newGroupBtn">📁 新建分组</button>
                <button class="add-holding-btn" id="addHoldingBtn">+ 添加持仓</button>
            </div>
            <div class="batch-action-bar" id="batchActionBar" style="display:none;">
                <span class="batch-info" id="batchInfo">已选择 0 只基金</span>
                <button class="batch-btn batch-add" id="batchAddBtn">📈 批量加仓</button>
                <button class="batch-btn batch-reduce" id="batchReduceBtn">📉 批量减仓</button>
                <button class="batch-btn batch-group" id="batchGroupBtn">📁 设置分组</button>
                <button class="batch-btn batch-cancel" id="batchCancelBtn">取消选择</button>
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

        // 绑定新建分组按钮
        document.getElementById('newGroupBtn').addEventListener('click', function () {
            var name = prompt('请输入新分组名称:');
            if (name && name.trim()) {
                name = name.trim();
                var existingGroups = Store.getPortfolioGroups();
                if (existingGroups.indexOf(name) !== -1) {
                    showToast('该分组已存在', 'warning');
                    return;
                }
                // 创建空分组:添加一笔金额为0的持仓占位(不可见),标记该分组
                // 更好的方式:直接显示提示,用户通过"设置分组"将基金移入
                showToast('分组「' + name + '」已创建,请通过"设置分组"将基金移入该分组', 'success');
            }
        });

        // 绑定手动刷新
        document.getElementById('manualRefreshBtn').addEventListener('click', function () {
            refreshPortfolioData();
        });

        // 绑定批量操作按钮
        document.getElementById('batchAddBtn').addEventListener('click', function () {
            var selected = positions.filter(function (p) {
                return portfolioSelectedCodes.indexOf(p.code) !== -1;
            });
            if (selected.length === 0) { showToast('请先选择基金', 'warning'); return; }
            showBatchAddForm(selected);
        });

        document.getElementById('batchReduceBtn').addEventListener('click', function () {
            var selected = positions.filter(function (p) {
                return portfolioSelectedCodes.indexOf(p.code) !== -1 && !p.isCleared;
            });
            if (selected.length === 0) { showToast('请选择有持仓的基金', 'warning'); return; }
            showBatchReduceForm(selected);
        });

        document.getElementById('batchGroupBtn').addEventListener('click', function () {
            if (portfolioSelectedCodes.length === 0) { showToast('请先选择基金', 'warning'); return; }
            // 从选中的checkbox中收集 {code, oldGroup}
            var items = [];
            var checkboxes = document.querySelectorAll('.row-checkbox:checked');
            checkboxes.forEach(function (cb) {
                var g = cb.dataset.group;
                items.push({ code: cb.dataset.code, oldGroup: (g && g !== '__ungrouped__') ? g : '' });
            });
            if (items.length === 0) {
                // 兼容:无法获取分组信息时退化为code数组
                items = portfolioSelectedCodes;
            }
            showSetGroupForm(items, groups);
        });

        document.getElementById('batchCancelBtn').addEventListener('click', function () {
            portfolioSelectedCodes = [];
            loadPortfolioData(Store.getAggregatedPositions());
        });

        // 优先使用预加载数据(立即渲染,无loading)
        if (portfolioPreloadedData && portfolioPreloadedData.positions &&
            Date.now() - portfolioPreloadedData.time < 60000) {
            // 用预加载数据立即渲染
            renderPortfolioWithPreloaded(positions, portfolioPreloadedData);
            // 后台静默刷新(60秒后自动刷新)
            setTimeout(function () {
                if (document.getElementById('portfolioContent')) {
                    loadPortfolioData(Store.getAggregatedPositions());
                }
            }, 5000);
        } else {
            loadPortfolioData(positions);
        }
    }

    // 用预加载数据渲染持仓(立即显示)
    function renderPortfolioWithPreloaded(positions, preloaded) {
        var container = document.getElementById('portfolioContent');
        if (!container) return;

        if (!positions || positions.length === 0) {
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

        // 用预加载数据,复用loadPortfolioData的渲染逻辑(确保DOM结构与刷新路径一致)
        var navMap = preloaded.navMap;
        var changeRateMap = preloaded.changeRateMap;
        var estimates = preloaded.estimates;
        var groups = Store.getPortfolioGroups();

        // 按分组归类持仓
        var groupMap = {};
        var ungrouped = [];
        positions.forEach(function (p) {
            if (p.group) {
                if (!groupMap[p.group]) groupMap[p.group] = [];
                groupMap[p.group].push(p);
            } else {
                ungrouped.push(p);
            }
        });

        var groupNames = Object.keys(groupMap);
        // 默认展开所有分组
        if (Object.keys(portfolioExpandedGroups).length === 0) {
            groupNames.forEach(function (g) { portfolioExpandedGroups[g] = true; });
            if (ungrouped.length > 0) portfolioExpandedGroups['__ungrouped__'] = true;
        }

        // 计算总汇总
        var totals = Store.calcTotalAggregatedProfit(positions, navMap, changeRateMap);

        // 构建分组HTML(复用buildGroupSection)
        var groupSectionsHtml = '';
        groupNames.forEach(function (groupName) {
            var groupPositions = groupMap[groupName];
            var groupTotals = Store.calcTotalAggregatedProfit(groupPositions, navMap, changeRateMap);
            var isExpanded = portfolioExpandedGroups[groupName];
            groupSectionsHtml += buildGroupSection(groupName, groupPositions, groupTotals, isExpanded, navMap, changeRateMap, estimates);
        });
        if (ungrouped.length > 0) {
            var ungroupedTotals = Store.calcTotalAggregatedProfit(ungrouped, navMap, changeRateMap);
            var isUngroupedExpanded = portfolioExpandedGroups['__ungrouped__'];
            groupSectionsHtml += buildGroupSection('__ungrouped__', ungrouped, ungroupedTotals, isUngroupedExpanded, navMap, changeRateMap, estimates, true);
        }

        // 总汇总(与loadPortfolioData相同的DOM结构,确保刷新可更新)
        var profitClass = totals.totalDailyProfit >= 0 ? 'profit-positive' : 'profit-negative';
        var profitSign = totals.totalDailyProfit >= 0 ? '+' : '';
        var cumClass = totals.totalCumulativeProfit >= 0 ? 'profit-positive' : 'profit-negative';
        var cumSign = totals.totalCumulativeProfit >= 0 ? '+' : '';

        container.innerHTML = `
            ${groupSectionsHtml}
            <div class="portfolio-total-summary">
                <div class="summary-header">
                    <span class="summary-title">📊 全部汇总</span>
                    <span class="summary-count">共 ${positions.length} 只基金</span>
                </div>
                <div class="summary-grid">
                    <div class="summary-item">
                        <div class="summary-label">持仓市值</div>
                        <div class="summary-value" data-summary="totalValue">¥${formatMoney(totals.totalValue)}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">持仓成本</div>
                        <div class="summary-value" data-summary="totalCost">¥${formatMoney(totals.totalCost)}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">当日收益</div>
                        <div class="summary-value ${profitClass}" data-summary="holdingProfit">${profitSign}${formatMoney(totals.totalDailyProfit)}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">累计盈亏</div>
                        <div class="summary-value ${cumClass}" data-summary="cumulativeProfit">${cumSign}${formatMoney(totals.totalCumulativeProfit)}</div>
                    </div>
                </div>
            </div>
        `;

        // 绑定分组折叠、行点击、自选等事件(复用loadPortfolioData的事件绑定)
        bindPortfolioGroupEvents(container, positions);

        // 启动自动刷新和刷新状态(与loadPortfolioData一致)
        updateRefreshStatus(true);
        startPortfolioAutoRefresh();
    }

    // 更新批量操作栏状态
    function updateBatchBar() {
        var bar = document.getElementById('batchActionBar');
        var info = document.getElementById('batchInfo');
        if (!bar) return;
        if (portfolioSelectedCodes.length > 0) {
            bar.style.display = 'flex';
            if (info) info.textContent = '已选择 ' + portfolioSelectedCodes.length + ' 只基金';
        } else {
            bar.style.display = 'none';
        }
    }

    // 绑定持仓分组事件(折叠/全选/行点击/操作按钮)
    function bindPortfolioGroupEvents(container, positions) {
        positions = positions || Store.getAggregatedPositions();
        // 分组折叠
        container.querySelectorAll('.portfolio-group-header').forEach(function (header) {
            header.addEventListener('click', function (e) {
                if (e.target.type === 'checkbox') return;
                var groupKey = this.dataset.group;
                var body = container.querySelector('.portfolio-group-body[data-group="' + groupKey + '"]');
                if (!body) return;
                var isCollapsed = this.classList.toggle('collapsed');
                body.style.display = isCollapsed ? 'none' : 'block';
                portfolioExpandedGroups[groupKey] = !isCollapsed;
                var icon = this.querySelector('.group-toggle-icon');
                if (icon) icon.textContent = isCollapsed ? '▶' : '▼';
            });
        });

        // 分组全选
        container.querySelectorAll('.group-select-all').forEach(function (cb) {
            cb.addEventListener('change', function (e) {
                e.stopPropagation();
                var groupKey = this.dataset.group;
                var checkboxes = container.querySelectorAll('.row-checkbox[data-group="' + groupKey + '"]');
                checkboxes.forEach(function (c) {
                    c.checked = cb.checked;
                    var code = c.dataset.code;
                    if (cb.checked) {
                        if (portfolioSelectedCodes.indexOf(code) === -1) portfolioSelectedCodes.push(code);
                    } else {
                        portfolioSelectedCodes = portfolioSelectedCodes.filter(function (x) { return x !== code; });
                    }
                });
                updateBatchBar();
            });
        });

        // 行点击和checkbox
        container.querySelectorAll('tr[data-code]').forEach(function (tr) {
            tr.addEventListener('click', function (e) {
                if (e.target.type === 'checkbox' || e.target.classList.contains('action-btn')) return;
                openDetail(this.dataset.code);
            });
        });
        container.querySelectorAll('.row-checkbox').forEach(function (cb) {
            cb.addEventListener('change', function (e) {
                e.stopPropagation();
                var code = this.dataset.code;
                if (this.checked) {
                    if (portfolioSelectedCodes.indexOf(code) === -1) portfolioSelectedCodes.push(code);
                } else {
                    portfolioSelectedCodes = portfolioSelectedCodes.filter(function (x) { return x !== code; });
                }
                updateBatchBar();
            });
        });

        // 操作按钮
        container.querySelectorAll('.action-btn[data-action="add-position"]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var code = this.dataset.code;
                var position = positions.find(function (p) { return p.code === code; });
                if (position) showAddPositionForm(position);
            });
        });
        container.querySelectorAll('.action-btn[data-action="reduce-position"]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var code = this.dataset.code;
                var position = positions.find(function (p) { return p.code === code; });
                if (position) showReducePositionForm(position);
            });
        });
        container.querySelectorAll('.action-btn[data-action="set-group"]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var code = this.dataset.code;
                // 查找该行所属的分组
                var tr = this.closest('tr');
                var groupSection = tr ? tr.closest('.portfolio-group-section') : null;
                var groupKey = groupSection ? groupSection.querySelector('.portfolio-group-header').dataset.group : '';
                var groupName = '';
                if (groupKey && groupKey !== '__ungrouped__') {
                    groupName = groupKey;
                }
                showSetGroupForm([{ code: code, oldGroup: groupName }]);
            });
        });
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
                        syncToServer('holdings');
                        renderPortfolio();
                    }
                }
            });
        });
        updateBatchBar();
    }

    async function loadPortfolioData(positions) {
        var container = document.getElementById('portfolioContent');
        if (!container) return;

        if (!positions || positions.length === 0) {
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

        // 构建净值映射和日涨跌幅映射（自动检测实际净值是否已公布）
        var navMaps = await buildPortfolioNavMaps(positions, estimates);
        var navMap = navMaps.navMap;
        var changeRateMap = navMaps.changeRateMap;

        // 按分组归类持仓
        var groupMap = {};  // {groupName: [positions]}
        var ungrouped = [];
        positions.forEach(function (p) {
            if (p.group) {
                if (!groupMap[p.group]) groupMap[p.group] = [];
                groupMap[p.group].push(p);
            } else {
                ungrouped.push(p);
            }
        });

        var groupNames = Object.keys(groupMap);
        // 默认展开所有分组（首次加载）
        if (Object.keys(portfolioExpandedGroups).length === 0) {
            groupNames.forEach(function (g) { portfolioExpandedGroups[g] = true; });
            if (ungrouped.length > 0) portfolioExpandedGroups['__ungrouped__'] = true;
        }

        // 计算总汇总
        var totals = Store.calcTotalAggregatedProfit(positions, navMap, changeRateMap);

        // 构建分组HTML
        var groupSectionsHtml = '';

        // 渲染每个命名分组
        groupNames.forEach(function (groupName) {
            var groupPositions = groupMap[groupName];
            var groupTotals = Store.calcTotalAggregatedProfit(groupPositions, navMap, changeRateMap);
            var isExpanded = portfolioExpandedGroups[groupName];
            groupSectionsHtml += buildGroupSection(groupName, groupPositions, groupTotals, isExpanded, navMap, changeRateMap, estimates);
        });

        // 渲染未分组
        if (ungrouped.length > 0) {
            var ungroupedTotals = Store.calcTotalAggregatedProfit(ungrouped, navMap, changeRateMap);
            var isUngroupedExpanded = portfolioExpandedGroups['__ungrouped__'];
            groupSectionsHtml += buildGroupSection('__ungrouped__', ungrouped, ungroupedTotals, isUngroupedExpanded, navMap, changeRateMap, estimates, true);
        }

        // 总汇总
        var profitClass = totals.totalDailyProfit >= 0 ? 'profit-positive' : 'profit-negative';
        var profitSign = totals.totalDailyProfit >= 0 ? '+' : '';
        var cumClass = totals.totalCumulativeProfit >= 0 ? 'profit-positive' : 'profit-negative';
        var cumSign = totals.totalCumulativeProfit >= 0 ? '+' : '';

        container.innerHTML = `
            ${groupSectionsHtml}
            <div class="portfolio-total-summary">
                <div class="summary-header">
                    <span class="summary-title">📊 全部汇总</span>
                    <span class="summary-count">共 ${positions.length} 只基金</span>
                </div>
                <div class="summary-grid">
                    <div class="summary-item">
                        <div class="summary-label">持仓市值</div>
                        <div class="summary-value" data-summary="totalValue">¥${formatMoney(totals.totalValue)}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">持仓成本</div>
                        <div class="summary-value" data-summary="totalCost">¥${formatMoney(totals.totalCost)}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">当日收益</div>
                        <div class="summary-value ${profitClass}" data-summary="holdingProfit">${profitSign}${formatMoney(totals.totalDailyProfit)}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">累计盈亏</div>
                        <div class="summary-value ${cumClass}" data-summary="cumulativeProfit">${cumSign}${formatMoney(totals.totalCumulativeProfit)}</div>
                    </div>
                </div>
            </div>
        `;

        // 绑定分组展开/折叠
        container.querySelectorAll('.portfolio-group-header').forEach(function (header) {
            header.addEventListener('click', function (e) {
                if (e.target.classList.contains('action-btn') || e.target.type === 'checkbox') return;
                var groupName = this.dataset.group;
                var body = container.querySelector('.portfolio-group-body[data-group="' + groupName + '"]');
                if (body) {
                    var isExp = body.style.display !== 'none';
                    body.style.display = isExp ? 'none' : 'block';
                    portfolioExpandedGroups[groupName] = !isExp;
                    this.classList.toggle('collapsed', isExp);
                }
            });
        });

        // 绑定全选（每个分组内）
        container.querySelectorAll('.group-select-all').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var groupName = this.dataset.group;
                var checked = this.checked;
                container.querySelectorAll('.row-checkbox[data-group="' + groupName + '"]').forEach(function (rcb) {
                    rcb.checked = checked;
                    var code = rcb.dataset.code;
                    if (checked && portfolioSelectedCodes.indexOf(code) === -1) {
                        portfolioSelectedCodes.push(code);
                    } else if (!checked) {
                        portfolioSelectedCodes = portfolioSelectedCodes.filter(function (c) { return c !== code; });
                    }
                });
                updateBatchBar();
            });
        });

        // 绑定行复选框
        container.querySelectorAll('.row-checkbox').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var code = this.dataset.code;
                if (this.checked && portfolioSelectedCodes.indexOf(code) === -1) {
                    portfolioSelectedCodes.push(code);
                } else if (!this.checked) {
                    portfolioSelectedCodes = portfolioSelectedCodes.filter(function (c) { return c !== code; });
                }
                updateBatchBar();
            });
        });

        updateBatchBar();

        // 绑定行点击事件
        container.querySelectorAll('tr[data-code]').forEach(function (tr) {
            tr.addEventListener('click', function (e) {
                if (e.target.classList.contains('action-btn')) return;
                if (e.target.type === 'checkbox') return;
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
                        syncToServer('holdings');
                        renderPortfolio();
                    }
                }
            });
        });

        // 绑定单个分组按钮
        container.querySelectorAll('.action-btn[data-action="set-group"]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var code = this.dataset.code;
                var groups = Store.getPortfolioGroups();
                showSetGroupForm([code], groups);
            });
        });

        // 首次加载完成，启动自动刷新
        updateRefreshStatus(true);
        startPortfolioAutoRefresh();
    }

    // 构建单个分组区块
    function buildGroupSection(groupName, groupPositions, groupTotals, isExpanded, navMap, changeRateMap, estimates, isUngrouped) {
        var displayName = isUngrouped ? '未分组' : groupName;
        var profitClass = groupTotals.totalDailyProfit >= 0 ? 'profit-positive' : 'profit-negative';
        var profitSign = groupTotals.totalDailyProfit >= 0 ? '+' : '';
        var cumClass = groupTotals.totalCumulativeProfit >= 0 ? 'profit-positive' : 'profit-negative';
        var cumSign = groupTotals.totalCumulativeProfit >= 0 ? '+' : '';
        var groupKey = isUngrouped ? '__ungrouped__' : groupName;

        var rowsHtml = groupPositions.map(function (p) {
            var currentNav = navMap[p.code] || (p.currentShares > 0.0001 ? p.costPrice : 0);
            var dailyChange = changeRateMap[p.code] || 0;
            var calc = Store.calcPositionProfit(p, currentNav, dailyChange);
            var pClass = calc.dailyProfit >= 0 ? 'profit-positive' : 'profit-negative';
            var pSign = calc.dailyProfit >= 0 ? '+' : '';
            var dClass = FundAPI.getChangeClass(dailyChange);
            var dSign = parseFloat(dailyChange) >= 0 ? '+' : '';
            var est = estimates.find(function (e) { return e.fundcode === p.code; });
            var displayName = (est && est.name) || p.name;
            var clearedBadge = p.isCleared ? '<span class="cleared-badge">已清仓</span>' : '';
            var isChecked = portfolioSelectedCodes.indexOf(p.code) !== -1;
            return `
                <tr data-code="${p.code}">
                    <td class="col-checkbox"><input type="checkbox" class="row-checkbox" data-code="${p.code}" data-group="${groupKey}" ${isChecked ? 'checked' : ''}></td>
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
                    <td class="num-cell ${pClass}" data-cell="profit" data-code="${p.code}">${pSign}${formatMoney(calc.dailyProfit)}</td>
                    <td class="num-cell" data-cell="dailyChange" data-code="${p.code}">
                        <span class="change-badge ${dClass === 'up' ? 'bg-up' : dClass === 'down' ? 'bg-down' : 'bg-flat'}">
                            ${dSign}${parseFloat(dailyChange).toFixed(2)}%
                        </span>
                    </td>
                    <td class="action-cell">
                        <button class="action-btn add-position" data-action="add-position" data-code="${p.code}">加仓</button>
                        ${p.isCleared ? '' : '<button class="action-btn sell-position" data-action="reduce-position" data-code="' + p.code + '">减仓</button>'}
                        <button class="action-btn" data-action="set-group" data-code="${p.code}">分组</button>
                        <button class="action-btn" data-action="delete-fund" data-code="${p.code}">删除</button>
                    </td>
                </tr>
            `;
        }).join('');

        return `
            <div class="portfolio-group-section">
                <div class="portfolio-group-header ${isExpanded ? '' : 'collapsed'}" data-group="${groupKey}">
                    <div class="group-header-left">
                        <span class="group-toggle-icon">${isExpanded ? '▼' : '▶'}</span>
                        <input type="checkbox" class="group-select-all" data-group="${groupKey}" title="全选该分组">
                        <span class="group-name-text">${escapeHtml(displayName)}</span>
                        <span class="group-count">${groupPositions.length}只</span>
                    </div>
                    <div class="group-header-right">
                        <span class="group-stat">市值 <strong>¥${formatMoney(groupTotals.totalValue)}</strong></span>
                        <span class="group-stat">成本 <strong>¥${formatMoney(groupTotals.totalCost)}</strong></span>
                        <span class="group-stat ${profitClass}">当日收益 <strong>${profitSign}${formatMoney(groupTotals.totalDailyProfit)}</strong></span>
                        <span class="group-stat ${cumClass}">累计 <strong>${cumSign}${formatMoney(groupTotals.totalCumulativeProfit)}</strong></span>
                    </div>
                </div>
                <div class="portfolio-group-body" data-group="${groupKey}" style="display: ${isExpanded ? 'block' : 'none'};">
                    <table class="fund-table portfolio-table">
                        <thead>
                            <tr>
                                <th class="th-checkbox"></th>
                                <th>基金名称</th>
                                <th class="text-right">持有份额</th>
                                <th class="text-right">成本价</th>
                                <th class="text-right">最新净值</th>
                                <th class="text-right">持仓市值</th>
                                <th class="text-right">当日收益</th>
                                <th class="text-right">日涨跌幅</th>
                                <th class="text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // ========== 持仓实时刷新 ==========
    var REFRESH_INTERVAL = 30; // 自动刷新间隔（秒）
    var countdownLeft = REFRESH_INTERVAL;

    function startPortfolioAutoRefresh() {
        stopPortfolioAutoRefresh();

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

        // 构建净值映射和日涨跌幅映射（自动检测实际净值是否已公布）
        var navMaps = await buildPortfolioNavMaps(positions, estimates);
        var navMap = navMaps.navMap;
        var changeRateMap = navMaps.changeRateMap;

        // 更新总览数据
        var totals = Store.calcTotalAggregatedProfit(positions, navMap, changeRateMap);
        updateSummaryCell('totalValue', '¥' + formatMoney(totals.totalValue));
        updateSummaryCell('totalCost', '¥' + formatMoney(totals.totalCost));

        var profitClass = totals.totalDailyProfit >= 0 ? 'profit-positive' : 'profit-negative';
        var profitSign = totals.totalDailyProfit >= 0 ? '+' : '';
        updateSummaryCell('holdingProfit', profitSign + formatMoney(totals.totalDailyProfit), profitClass);

        var cumClass = totals.totalCumulativeProfit >= 0 ? 'profit-positive' : 'profit-negative';
        var cumSign = totals.totalCumulativeProfit >= 0 ? '+' : '';
        updateSummaryCell('cumulativeProfit', cumSign + formatMoney(totals.totalCumulativeProfit), cumClass);

        // 更新每个分组的汇总数据
        var groupMap = {};
        var ungrouped = [];
        positions.forEach(function (p) {
            if (p.group) {
                if (!groupMap[p.group]) groupMap[p.group] = [];
                groupMap[p.group].push(p);
            } else {
                ungrouped.push(p);
            }
        });
        Object.keys(groupMap).forEach(function (gName) {
            var gTotals = Store.calcTotalAggregatedProfit(groupMap[gName], navMap, changeRateMap);
            updateGroupStats(gName, gTotals);
        });
        if (ungrouped.length > 0) {
            var uTotals = Store.calcTotalAggregatedProfit(ungrouped, navMap, changeRateMap);
            updateGroupStats('__ungrouped__', uTotals);
        }

        // 更新每行数据
        positions.forEach(function (p) {
            var currentNav = navMap[p.code] || (p.currentShares > 0.0001 ? p.costPrice : 0);
            var dailyChange = changeRateMap[p.code] || 0;
            var calc = Store.calcPositionProfit(p, currentNav, dailyChange);
            var pClass = calc.dailyProfit >= 0 ? 'profit-positive' : 'profit-negative';
            var pSign = calc.dailyProfit >= 0 ? '+' : '';
            var dClass = FundAPI.getChangeClass(dailyChange);
            var dSign = parseFloat(dailyChange) >= 0 ? '+' : '';

            updateTableCell('nav', p.code, FundAPI.formatNum(currentNav));
            updateTableCell('value', p.code, '¥' + formatMoney(calc.currentValue));
            updateTableCell('profit', p.code, pSign + formatMoney(calc.dailyProfit), pClass);
            updateTableCell('dailyChange', p.code,
                '<span class="change-badge ' + (dClass === 'up' ? 'bg-up' : dClass === 'down' ? 'bg-down' : 'bg-flat') + '">' +
                dSign + parseFloat(dailyChange).toFixed(2) + '%</span>');
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

    // 更新分组汇总数据（实时刷新时调用）
    function updateGroupStats(groupKey, gTotals) {
        var header = document.querySelector('.portfolio-group-header[data-group="' + groupKey + '"]');
        if (!header) return;
        var pClass = gTotals.totalDailyProfit >= 0 ? 'profit-positive' : 'profit-negative';
        var pSign = gTotals.totalDailyProfit >= 0 ? '+' : '';
        var cClass = gTotals.totalCumulativeProfit >= 0 ? 'profit-positive' : 'profit-negative';
        var cSign = gTotals.totalCumulativeProfit >= 0 ? '+' : '';
        var stats = header.querySelectorAll('.group-stat');
        if (stats.length >= 4) {
            stats[0].innerHTML = '市值 <strong>¥' + formatMoney(gTotals.totalValue) + '</strong>';
            stats[1].innerHTML = '成本 <strong>¥' + formatMoney(gTotals.totalCost) + '</strong>';
            stats[2].innerHTML = '当日收益 <strong>' + pSign + formatMoney(gTotals.totalDailyProfit) + '</strong>';
            stats[2].className = 'group-stat ' + pClass;
            stats[3].innerHTML = '累计 <strong>' + cSign + formatMoney(gTotals.totalCumulativeProfit) + '</strong>';
            stats[3].className = 'group-stat ' + cClass;
        }
    }

    // ========== 首页自动刷新 ==========
    var HOME_REFRESH_INTERVAL = 120; // 首页自动刷新间隔（秒）

    function startHomeAutoRefresh() {
        stopHomeAutoRefresh();
        homeRefreshTimer = setInterval(function () {
            // 仅在首页时刷新
            var path = location.hash.slice(1) || '/';
            if (path !== '/' && path !== '') {
                stopHomeAutoRefresh();
                return;
            }
            refreshHomeData();
        }, HOME_REFRESH_INTERVAL * 1000);
    }

    function stopHomeAutoRefresh() {
        if (homeRefreshTimer) { clearInterval(homeRefreshTimer); homeRefreshTimer = null; }
    }

    function updateRankingRefreshStatus(isSuccess) {
        var statusEl = document.getElementById('rankingRefreshStatus');
        if (!statusEl) return;
        var now = new Date();
        var timeStr = String(now.getHours()).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0') + ':' +
            String(now.getSeconds()).padStart(2, '0');
        statusEl.textContent = (isSuccess ? '已更新 ' : '更新失败 ') + timeStr;
    }

    // 刷新首页数据：板块行情 + 涨跌榜 + 持仓概览
    // 大盘指数和资讯由独立的自动刷新定时器处理,不在此处刷新
    async function refreshHomeData() {
        var tasks = [];
        // 1. 赛道板块
        var sectorSection = document.getElementById('sectorSection');
        if (sectorSection && sectorSection.dataset.loaded === 'true') {
            var activeSectorTab = document.querySelector('.sector-tab.active');
            if (activeSectorTab) {
                var sCat = activeSectorTab.dataset.category || '行业板块';
                tasks.push(loadSectors(sCat));
            }
        }
        // 3. 涨跌榜
        var rankingSection = document.getElementById('rankingSection');
        if (rankingSection && rankingSection.dataset.loaded === 'true') {
            tasks.push(loadRanking(currentRankingType, currentRankingOrder, currentFundType));
        }
        // 4. 持仓概览
        tasks.push(loadPortfolioOverview());
        // 资讯由独立的自动更新定时器处理,不在此处刷新
        // 并行执行所有
        if (tasks.length > 0) await Promise.all(tasks);
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
                <div class="form-group">
                    <label class="form-label">分组(可选)</label>
                    <input type="text" class="form-input" id="holdingGroup" value="${escapeHtml(data.group || '')}" placeholder="输入分组名称,留空则不分组" list="holdingGroupList" autocomplete="off">
                    <datalist id="holdingGroupList">
                        ${Store.getPortfolioGroups().map(function (g) { return '<option value="' + escapeHtml(g) + '">'; }).join('')}
                    </datalist>
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
                if (!isLoggedIn()) {
                    showToast('请先登录后再添加持仓', 'warning');
                    var modal = document.getElementById('holdingModal');
                    if (modal) modal.classList.remove('active');
                    document.getElementById('loginBtn').click();
                    return;
                }

                var result = Store.addHolding({
                    code: submitCode,
                    name: submitName || submitCode,
                    type: submitType,
                    amount: amount,
                    buyPrice: parseFloat(fetchedNav),
                    buyDate: buyDate,
                    group: (document.getElementById('holdingGroup') || {}).value || ''
                });

                showToast(result.message, result.success ? 'success' : 'error');
                if (result.success) {
                    syncToServer('holdings');
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
                    buyDate: buyDate,
                    group: position.group || ''
                });

                showToast(result.message, result.success ? 'success' : 'error');
                if (result.success) {
                    syncToServer('holdings');
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
                    <label class="form-label">减仓方式</label>
                    <div class="reduce-mode-tabs">
                        <button class="reduce-mode-tab active" data-mode="shares">按份额</button>
                        <button class="reduce-mode-tab" data-mode="amount">按金额</button>
                    </div>
                </div>
                <div class="form-group" id="reduceBySharesGroup">
                    <label class="form-label">赎回份额 <span class="required">*</span></label>
                    <div class="input-with-btn">
                        <input type="number" class="form-input" id="reducePosShares" value="" step="0.01" placeholder="输入赎回份额">
                        <button class="btn-mini" id="reduceAllBtn">全部</button>
                    </div>
                </div>
                <div class="form-group" id="reduceByAmountGroup" style="display:none;">
                    <label class="form-label">赎回金额 <span class="required">*</span></label>
                    <div class="input-with-btn">
                        <input type="number" class="form-input" id="reducePosAmount" value="" step="0.01" placeholder="输入赎回金额（元）">
                        <button class="btn-mini" id="reduceAllAmountBtn">全部</button>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">赎回日期</label>
                    <input type="date" class="form-input" id="reducePosDate" value="">
                </div>
                <div class="form-preview" id="reducePreview" style="display:none;">
                    <div class="preview-row"><span>实际赎回份额</span><span id="previewShares" class="preview-value">--</span></div>
                    <div class="preview-row"><span>预计到账金额</span><span id="previewAmount" class="preview-value">--</span></div>
                    <div class="preview-row"><span>预计收益</span><span id="previewProfit" class="preview-value">--</span></div>
                    <div class="preview-row"><span>赎回后剩余份额</span><span id="previewRemaining" class="preview-value">--</span></div>
                </div>
                <div class="form-actions">
                    <button class="form-cancel" id="reducePosCancelBtn">取消</button>
                    <button class="form-submit" id="reducePosSubmitBtn">确认减仓</button>
                </div>
            </div>
        `;

        holdingModal.classList.add('active');

        var currentMode = 'shares'; // 'shares' or 'amount'
        var currentNav = '';

        // 获取当前净值作为赎回价
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

        // 模式切换
        holdingFormContent.querySelectorAll('.reduce-mode-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                currentMode = this.dataset.mode;
                holdingFormContent.querySelectorAll('.reduce-mode-tab').forEach(function (t) { t.classList.remove('active'); });
                this.classList.add('active');
                if (currentMode === 'shares') {
                    document.getElementById('reduceBySharesGroup').style.display = 'block';
                    document.getElementById('reduceByAmountGroup').style.display = 'none';
                } else {
                    document.getElementById('reduceBySharesGroup').style.display = 'none';
                    document.getElementById('reduceByAmountGroup').style.display = 'block';
                }
                updatePreview();
            });
        });

        // 更新预览
        function updatePreview() {
            var preview = document.getElementById('reducePreview');
            var shares = 0;
            var amount = 0;

            if (currentMode === 'shares') {
                shares = parseFloat(document.getElementById('reducePosShares').value) || 0;
            } else {
                amount = parseFloat(document.getElementById('reducePosAmount').value) || 0;
                if (amount > 0 && currentNav && parseFloat(currentNav) > 0) {
                    shares = amount / parseFloat(currentNav);
                }
            }

            if (shares > 0 && currentNav && parseFloat(currentNav) > 0) {
                var nav = parseFloat(currentNav);
                amount = shares * nav;
                var profit = shares * (nav - position.costPrice);
                var profitStr = (profit >= 0 ? '+' : '') + profit.toFixed(2);
                var remaining = position.currentShares - shares;
                document.getElementById('previewShares').textContent = shares.toFixed(2) + ' 份';
                document.getElementById('previewAmount').textContent = '¥' + amount.toFixed(2);
                document.getElementById('previewProfit').textContent = profitStr;
                document.getElementById('previewProfit').style.color = profit >= 0 ? '#f5222d' : '#52c41a';
                document.getElementById('previewRemaining').textContent = remaining.toFixed(2) + ' 份';
                preview.style.display = 'block';
            } else {
                preview.style.display = 'none';
            }
        }

        // 输入时更新预览
        document.getElementById('reducePosShares').addEventListener('input', updatePreview);
        document.getElementById('reducePosAmount').addEventListener('input', updatePreview);

        // 全部按钮 - 按份额
        document.getElementById('reduceAllBtn').addEventListener('click', function () {
            document.getElementById('reducePosShares').value = position.currentShares.toFixed(2);
            updatePreview();
        });

        // 全部按钮 - 按金额
        document.getElementById('reduceAllAmountBtn').addEventListener('click', function () {
            if (currentNav && parseFloat(currentNav) > 0) {
                var totalAmount = position.currentShares * parseFloat(currentNav);
                document.getElementById('reducePosAmount').value = totalAmount.toFixed(2);
                updatePreview();
            } else {
                showToast('正在获取净值，请稍后', 'warning');
            }
        });

        // 取消按钮
        document.getElementById('reducePosCancelBtn').addEventListener('click', function () {
            holdingModal.classList.remove('active');
        });

        // 提交按钮
        document.getElementById('reducePosSubmitBtn').addEventListener('click', function () {
            var shares = 0;

            if (currentMode === 'shares') {
                shares = parseFloat(document.getElementById('reducePosShares').value);
                if (!shares || shares <= 0) {
                    showToast('请输入有效的赎回份额', 'warning');
                    return;
                }
            } else {
                var amount = parseFloat(document.getElementById('reducePosAmount').value);
                if (!amount || amount <= 0) {
                    showToast('请输入有效的赎回金额', 'warning');
                    return;
                }
            }

            var sellDate = document.getElementById('reducePosDate').value;

            if (shares > position.currentShares + 0.0001) {
                showToast('赎回份额不能超过持有份额（' + position.currentShares.toFixed(2) + '份）', 'warning');
                return;
            }

            if (!currentNav || parseFloat(currentNav) <= 0) {
                showToast('正在获取基金净值，请稍后...', 'warning');
                FundAPI.getRealtimeEstimate(position.code).then(function (est) {
                    if (est && (est.gsz || est.dwjz)) {
                        currentNav = est.gsz || est.dwjz;
                        if (currentMode === 'amount') {
                            shares = parseFloat(document.getElementById('reducePosAmount').value) / parseFloat(currentNav);
                        }
                        doReducePosition();
                    } else {
                        showToast('无法获取基金净值，请稍后重试', 'error');
                    }
                });
            } else {
                if (currentMode === 'amount') {
                    shares = parseFloat(document.getElementById('reducePosAmount').value) / parseFloat(currentNav);
                }
                doReducePosition();
            }

            function doReducePosition() {
                var result = Store.addSellTransaction({
                    code: position.code,
                    name: position.name || position.code,
                    type: position.type || '',
                    shares: shares,
                    price: parseFloat(currentNav),
                    date: sellDate,
                    group: position.group || ''
                });

                showToast(result.message, result.success ? 'success' : 'error');
                if (result.success) {
                    syncToServer('holdings');
                    holdingModal.classList.remove('active');
                    renderPortfolio();
                }
            }
        });
    }

    // ========== 批量加仓表单 ==========
    function showBatchAddForm(selectedPositions) {
        var holdingModal = document.getElementById('holdingModal');
        var holdingFormContent = document.getElementById('holdingFormContent');

        var fundListHtml = selectedPositions.map(function (p) {
            return '<div class="batch-fund-item"><span>' + escapeHtml(p.name || p.code) + '</span><span class="batch-fund-code">' + p.code + '</span></div>';
        }).join('');

        holdingFormContent.innerHTML = `
            <div class="form-header">
                <h3>📈 批量加仓 · ${selectedPositions.length} 只基金</h3>
            </div>
            <div class="form-body">
                <div class="batch-fund-list">${fundListHtml}</div>
                <div class="form-group">
                    <label class="form-label">每只基金加仓金额(元) <span class="required">*</span></label>
                    <input type="number" class="form-input" id="batchAddAmount" value="" step="0.01" placeholder="如 1000（每只基金加仓相同金额）">
                </div>
                <div class="form-group">
                    <label class="form-label">买入日期</label>
                    <input type="date" class="form-input" id="batchAddDate" value="">
                </div>
                <div class="form-preview" id="batchAddPreview" style="display:none;">
                    <div class="preview-row"><span>预计总投入</span><span id="batchAddTotal" class="preview-value">--</span></div>
                </div>
                <div class="form-actions">
                    <button class="form-cancel" id="batchAddCancelBtn">取消</button>
                    <button class="form-submit" id="batchAddSubmitBtn">确认批量加仓</button>
                </div>
            </div>
        `;

        holdingModal.classList.add('active');

        // 设置默认日期
        var today = new Date();
        var dateStr = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');
        document.getElementById('batchAddDate').value = dateStr;

        // 更新预览
        function updatePreview() {
            var amount = parseFloat(document.getElementById('batchAddAmount').value) || 0;
            var preview = document.getElementById('batchAddPreview');
            if (amount > 0) {
                document.getElementById('batchAddTotal').textContent = '¥' + (amount * selectedPositions.length).toFixed(2);
                preview.style.display = 'block';
            } else {
                preview.style.display = 'none';
            }
        }
        document.getElementById('batchAddAmount').addEventListener('input', updatePreview);

        // 取消按钮
        document.getElementById('batchAddCancelBtn').addEventListener('click', function () {
            holdingModal.classList.remove('active');
        });

        // 提交按钮
        document.getElementById('batchAddSubmitBtn').addEventListener('click', function () {
            var amount = parseFloat(document.getElementById('batchAddAmount').value);
            var buyDate = document.getElementById('batchAddDate').value;

            if (!amount || amount <= 0) {
                showToast('请输入有效的加仓金额', 'warning');
                return;
            }

            var submitBtn = this;
            submitBtn.disabled = true;
            submitBtn.textContent = '获取净值中...';

            // 获取所有基金的当前净值
            var codes = selectedPositions.map(function (p) { return p.code; });
            FundAPI.batchRealtimeEstimate(codes).then(function (estimates) {
                var items = [];
                var failCount = 0;
                selectedPositions.forEach(function (p) {
                    var est = estimates.find(function (e) { return e.fundcode === p.code; });
                    var nav = est ? (est.gsz || est.dwjz) : 0;
                    if (nav && parseFloat(nav) > 0) {
                        items.push({
                            code: p.code,
                            name: p.name || p.code,
                            type: p.type || '',
                            amount: amount,
                            buyPrice: parseFloat(nav),
                            buyDate: buyDate,
                            group: p.group || ''
                        });
                    } else {
                        failCount++;
                    }
                });

                if (items.length === 0) {
                    showToast('无法获取任何基金净值，请稍后重试', 'error');
                    submitBtn.disabled = false;
                    submitBtn.textContent = '确认批量加仓';
                    return;
                }

                var result = Store.batchAddPosition(items);
                showToast(result.message, result.success ? 'success' : 'error');
                if (result.success) {
                    syncToServer('holdings');
                    holdingModal.classList.remove('active');
                    portfolioSelectedCodes = [];
                    renderPortfolio();
                } else {
                    submitBtn.disabled = false;
                    submitBtn.textContent = '确认批量加仓';
                }
            }).catch(function () {
                showToast('获取净值失败，请稍后重试', 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = '确认批量加仓';
            });
        });
    }

    // ========== 批量减仓表单 ==========
    function showBatchReduceForm(selectedPositions) {
        var holdingModal = document.getElementById('holdingModal');
        var holdingFormContent = document.getElementById('holdingFormContent');

        var fundListHtml = selectedPositions.map(function (p) {
            return '<div class="batch-fund-item"><span>' + escapeHtml(p.name || p.code) + '</span><span class="batch-fund-code">' + p.currentShares.toFixed(2) + ' 份</span></div>';
        }).join('');

        holdingFormContent.innerHTML = `
            <div class="form-header">
                <h3>📉 批量减仓 · ${selectedPositions.length} 只基金</h3>
            </div>
            <div class="form-body">
                <div class="batch-fund-list">${fundListHtml}</div>
                <div class="form-group">
                    <label class="form-label">减仓方式</label>
                    <div class="reduce-mode-tabs">
                        <button class="reduce-mode-tab active" data-mode="percent">按比例</button>
                        <button class="reduce-mode-tab" data-mode="shares">按份额</button>
                        <button class="reduce-mode-tab" data-mode="amount">按金额</button>
                    </div>
                </div>
                <div class="form-group" id="batchReducePercentGroup">
                    <label class="form-label">减仓比例 <span class="required">*</span></label>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <input type="number" class="form-input" id="batchReducePercent" value="50" min="1" max="100" step="1" style="flex:1;">
                        <span style="white-space:nowrap; color: var(--text-secondary);">%</span>
                    </div>
                    <div class="quick-percent-btns">
                        <button class="quick-percent-btn" data-percent="25">25%</button>
                        <button class="quick-percent-btn" data-percent="50">50%</button>
                        <button class="quick-percent-btn" data-percent="75">75%</button>
                        <button class="quick-percent-btn" data-percent="100">全部</button>
                    </div>
                </div>
                <div class="form-group" id="batchReduceSharesGroup" style="display:none;">
                    <label class="form-label">每只基金赎回份额 <span class="required">*</span></label>
                    <input type="number" class="form-input" id="batchReduceShares" value="" step="0.01" placeholder="每只基金赎回相同份额">
                    <div class="form-hint">注：各基金份额独立计算，不足时按实际持有量赎回</div>
                </div>
                <div class="form-group" id="batchReduceAmountGroup" style="display:none;">
                    <label class="form-label">每只基金赎回金额 <span class="required">*</span></label>
                    <input type="number" class="form-input" id="batchReduceAmount" value="" step="0.01" placeholder="每只基金赎回相同金额（元）">
                    <div class="form-hint">注：按当前净值折算份额，各基金实际份额不同</div>
                </div>
                <div class="form-group">
                    <label class="form-label">赎回日期</label>
                    <input type="date" class="form-input" id="batchReduceDate" value="">
                </div>
                <div class="form-actions">
                    <button class="form-cancel" id="batchReduceCancelBtn">取消</button>
                    <button class="form-submit" id="batchReduceSubmitBtn">确认批量减仓</button>
                </div>
            </div>
        `;

        holdingModal.classList.add('active');

        var batchReduceMode = 'percent'; // 'percent', 'shares', 'amount'

        // 设置默认日期
        var today = new Date();
        var dateStr = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');
        document.getElementById('batchReduceDate').value = dateStr;

        // 模式切换
        holdingFormContent.querySelectorAll('.reduce-mode-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                batchReduceMode = this.dataset.mode;
                holdingFormContent.querySelectorAll('.reduce-mode-tab').forEach(function (t) { t.classList.remove('active'); });
                this.classList.add('active');
                document.getElementById('batchReducePercentGroup').style.display = batchReduceMode === 'percent' ? 'block' : 'none';
                document.getElementById('batchReduceSharesGroup').style.display = batchReduceMode === 'shares' ? 'block' : 'none';
                document.getElementById('batchReduceAmountGroup').style.display = batchReduceMode === 'amount' ? 'block' : 'none';
            });
        });

        // 快捷比例按钮
        holdingFormContent.querySelectorAll('.quick-percent-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.getElementById('batchReducePercent').value = this.dataset.percent;
            });
        });

        // 取消按钮
        document.getElementById('batchReduceCancelBtn').addEventListener('click', function () {
            holdingModal.classList.remove('active');
        });

        // 提交按钮
        document.getElementById('batchReduceSubmitBtn').addEventListener('click', function () {
            var sellDate = document.getElementById('batchReduceDate').value;

            // 验证输入
            if (batchReduceMode === 'percent') {
                var percent = parseFloat(document.getElementById('batchReducePercent').value);
                if (!percent || percent <= 0 || percent > 100) {
                    showToast('请输入有效的减仓比例（1-100）', 'warning');
                    return;
                }
            } else if (batchReduceMode === 'shares') {
                var shares = parseFloat(document.getElementById('batchReduceShares').value);
                if (!shares || shares <= 0) {
                    showToast('请输入有效的赎回份额', 'warning');
                    return;
                }
            } else if (batchReduceMode === 'amount') {
                var amount = parseFloat(document.getElementById('batchReduceAmount').value);
                if (!amount || amount <= 0) {
                    showToast('请输入有效的赎回金额', 'warning');
                    return;
                }
            }

            var submitBtn = this;
            submitBtn.disabled = true;
            submitBtn.textContent = '获取净值中...';

            // 获取所有基金的当前净值
            var codes = selectedPositions.map(function (p) { return p.code; });
            FundAPI.batchRealtimeEstimate(codes).then(function (estimates) {
                var items = [];
                var failCount = 0;
                selectedPositions.forEach(function (p) {
                    var est = estimates.find(function (e) { return e.fundcode === p.code; });
                    var nav = est ? (est.gsz || est.dwjz) : 0;
                    var navNum = parseFloat(nav) || 0;

                    if (batchReduceMode === 'percent') {
                        items.push({
                            code: p.code,
                            name: p.name || p.code,
                            type: p.type || '',
                            percent: parseFloat(document.getElementById('batchReducePercent').value),
                            price: navNum,
                            date: sellDate
                        });
                    } else if (batchReduceMode === 'shares') {
                        var reqShares = parseFloat(document.getElementById('batchReduceShares').value);
                        // 限制不超过持有份额
                        if (reqShares > p.currentShares) {
                            reqShares = p.currentShares;
                        }
                        items.push({
                            code: p.code,
                            name: p.name || p.code,
                            type: p.type || '',
                            shares: reqShares,
                            price: navNum,
                            date: sellDate
                        });
                    } else if (batchReduceMode === 'amount') {
                        var reqAmount = parseFloat(document.getElementById('batchReduceAmount').value);
                        if (navNum <= 0) {
                            failCount++;
                            return;
                        }
                        var calcShares = reqAmount / navNum;
                        // 限制不超过持有份额
                        if (calcShares > p.currentShares) {
                            calcShares = p.currentShares;
                        }
                        items.push({
                            code: p.code,
                            name: p.name || p.code,
                            type: p.type || '',
                            shares: calcShares,
                            price: navNum,
                            date: sellDate
                        });
                    }
                });

                if (items.length === 0) {
                    showToast('无法获取基金净值，请稍后重试', 'error');
                    submitBtn.disabled = false;
                    submitBtn.textContent = '确认批量减仓';
                    return;
                }

                // 按份额/金额模式直接调用 addSellTransaction
                if (batchReduceMode === 'shares' || batchReduceMode === 'amount') {
                    var successCount = 0;
                    var failMessages = [];
                    items.forEach(function (item) {
                        if (item.price <= 0 || !item.shares || item.shares <= 0) {
                            failMessages.push((item.name || item.code) + '：净值或份额无效');
                            return;
                        }
                        var result = Store.addSellTransaction({
                            code: item.code,
                            name: item.name,
                            type: item.type,
                            shares: item.shares,
                            price: item.price,
                            date: item.date,
                            group: item.group || ''
                        });
                        if (result.success) {
                            successCount++;
                        } else {
                            failMessages.push((item.name || item.code) + '：' + result.message);
                        }
                    });

                    var msg = '批量减仓完成，成功 ' + successCount + ' 只';
                    if (failMessages.length > 0) {
                        msg += '，失败 ' + failMessages.length + ' 只（' + failMessages.join('；') + '）';
                    }
                    showToast(msg, successCount > 0 ? 'success' : 'error');
                    if (successCount > 0) {
                        syncToServer('holdings');
                        holdingModal.classList.remove('active');
                        portfolioSelectedCodes = [];
                        renderPortfolio();
                    } else {
                        submitBtn.disabled = false;
                        submitBtn.textContent = '确认批量减仓';
                    }
                } else {
                    // 按比例模式
                    var result = Store.batchReducePosition(items);
                    showToast(result.message, result.success ? 'success' : 'error');
                    if (result.success) {
                        syncToServer('holdings');
                        holdingModal.classList.remove('active');
                        portfolioSelectedCodes = [];
                        renderPortfolio();
                    } else {
                        submitBtn.disabled = false;
                        submitBtn.textContent = '确认批量减仓';
                    }
                }
            }).catch(function () {
                showToast('获取净值失败，请稍后重试', 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = '确认批量减仓';
            });
        });
    }

    // ========== 设置分组表单 ==========
    // items: [{code, oldGroup}] 或 [code](兼容旧调用)
    function showSetGroupForm(items, existingGroups) {
        var holdingModal = document.getElementById('holdingModal');
        var holdingFormContent = document.getElementById('holdingFormContent');
        existingGroups = existingGroups || Store.getPortfolioGroups();

        // 统一转换为 {code, oldGroup} 格式
        var normalized = items.map(function (item) {
            if (typeof item === 'string') {
                var pos = Store.getAggregatedPosition(item);
                return { code: item, oldGroup: (pos && pos.group) || '' };
            }
            return item;
        });

        var isSingle = normalized.length === 1;

        // 如果是单个基金，预填当前分组
        var currentGroup = isSingle ? (normalized[0].oldGroup || '') : '';

        // 构建 datalist
        var dataListHtml = existingGroups.map(function (g) {
            return '<option value="' + escapeHtml(g) + '">';
        }).join('');

        holdingFormContent.innerHTML = `
            <div class="form-header">
                <h3>📁 ${isSingle ? '设置分组' : '批量设置分组'} · ${normalized.length} 只基金</h3>
            </div>
            <div class="form-body">
                <div class="form-group">
                    <label class="form-label">分组名称</label>
                    <input type="text" class="form-input" id="setGroupInput" value="${escapeHtml(currentGroup)}" placeholder="输入分组名称，如：股票型、债券型、定投" list="groupList" autocomplete="off">
                    <datalist id="groupList">${dataListHtml}</datalist>
                </div>
                <div class="form-group">
                    <label class="form-label">已有分组</label>
                    <div class="group-tag-list">
                        ${existingGroups.length > 0 ? existingGroups.map(function (g) {
                            return '<span class="group-tag-option" data-group="' + escapeHtml(g) + '">' + escapeHtml(g) + '</span>';
                        }).join('') : '<span style="color: var(--text-tertiary); font-size: 13px;">暂无分组</span>'}
                    </div>
                </div>
                <div class="form-actions">
                    <button class="form-cancel" id="setGroupCancelBtn">取消</button>
                    <button class="form-danger" id="setGroupRemoveBtn" style="${currentGroup ? '' : 'display:none;'}">移出分组</button>
                    <button class="form-submit" id="setGroupSubmitBtn">确认</button>
                </div>
            </div>
        `;

        holdingModal.classList.add('active');

        // 点击已有分组标签自动填充
        holdingFormContent.querySelectorAll('.group-tag-option').forEach(function (tag) {
            tag.addEventListener('click', function () {
                document.getElementById('setGroupInput').value = this.dataset.group;
            });
        });

        // 取消按钮
        document.getElementById('setGroupCancelBtn').addEventListener('click', function () {
            holdingModal.classList.remove('active');
        });

        // 移出分组按钮
        var removeBtn = document.getElementById('setGroupRemoveBtn');
        if (removeBtn) {
            removeBtn.addEventListener('click', function () {
                var result = Store.batchSetGroup(normalized, '');
                showToast(result.message, result.success ? 'success' : 'error');
                if (result.success) {
                    syncToServer('holdings');
                    holdingModal.classList.remove('active');
                    renderPortfolio();
                }
            });
        }

        // 确认按钮
        document.getElementById('setGroupSubmitBtn').addEventListener('click', function () {
            var groupName = document.getElementById('setGroupInput').value.trim();
            if (!groupName) {
                showToast('请输入分组名称', 'warning');
                return;
            }
            var result = Store.batchSetGroup(normalized, groupName);
            showToast(result.message, result.success ? 'success' : 'error');
            if (result.success) {
                syncToServer('holdings');
                holdingModal.classList.remove('active');
                renderPortfolio();
            }
        });
    }

    // ========== 自选页 ==========
    function renderFavorites() {
        if (!isLoggedIn()) {
            showLoginRequired('自选');
            return;
        }

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
                    syncToServer('favorites');
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
                syncToServer('favorites');
                renderFavorites();
            });
        });
    }

    // ========== 基金详情弹窗 ==========

    // 检查历史净值表首行是否为当日实际净值
    // 返回 { change, dwjz, date } 或 null
    function checkTodayActualNav(historyResult, estimate) {
        if (!historyResult || !historyResult.list || historyResult.list.length === 0) return null;
        var firstRow = historyResult.list[0];
        // 获取当日日期字符串(优先用估值接口返回的日期,其次用本地时间)
        var todayStr = '';
        if (estimate && estimate.jzrq && estimate.jzrq.length >= 10) {
            todayStr = estimate.jzrq.substring(0, 10); // "2026-07-20" -> "2026-07-20"
        } else if (estimate && estimate.gztime && estimate.gztime.length >= 10 && estimate.gztime.indexOf('-') > 0) {
            todayStr = estimate.gztime.substring(0, 10);
        } else {
            var now = new Date();
            todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        }
        if (firstRow.date === todayStr) {
            return { change: firstRow.change, dwjz: firstRow.dwjz, date: firstRow.date };
        }
        return null;
    }

    // 更新详情头部的日涨跌幅
    function updateDetailChangeRate(changeVal) {
        var metrics = detailContent.querySelectorAll('.metric-item');
        if (metrics.length >= 5) {
            var changeItem = metrics[4]; // 第5个metric是日涨跌幅
            var changeValueEl = changeItem.querySelector('.metric-value');
            var changeClass = FundAPI.getChangeClass(changeVal);
            if (changeValueEl) {
                changeValueEl.textContent = FundAPI.formatChange(changeVal);
                changeValueEl.className = 'metric-value ' + changeClass;
            }
        }
    }

    async function openDetail(fundCode) {
        currentDetailCode = fundCode;
        detailActualNavFound = false; // 重置状态
        detailModal.classList.add('active');
        detailContent.innerHTML = `
            <div style="padding: 80px; text-align: center;">
                <div class="loader" style="margin: 0 auto 16px;"></div>
                <p style="color: var(--text-secondary);">正在加载基金详情...</p>
            </div>
        `;

        // 并行获取数据（含历史净值首行，用于判断当日实际净值是否已公布）
        var [detail, estimate, trend, historyResult] = await Promise.all([
            FundAPI.getFundDetail(fundCode),
            FundAPI.getRealtimeEstimate(fundCode),
            FundAPI.getNavTrend(fundCode),
            FundAPI.getHistoryNav(fundCode, 1, 1)
        ]);

        // 检查历史净值表是否已出现当日实际净值
        var actualToday = checkTodayActualNav(historyResult, estimate);
        if (actualToday) {
            detailActualNavFound = true;
        }

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
        // 日涨跌幅：如果当日实际净值已公布，用实际值；否则用实时估值
        var displayChange = actualToday ? actualToday.change : (estimate ? estimate.gszzl : detail.change);
        var changeClass = FundAPI.getChangeClass(displayChange);
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
                        <div class="metric-value ${changeClass}">${FundAPI.formatChange(displayChange)}</div>
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

                <!-- 重仓股持仓 -->
                <div class="detail-section">
                    <div class="detail-section-title"><span>🏭</span> 股票持仓（重仓股）</div>
                    <div class="holdings-wrap" id="holdingsWrap">
                        <div style="padding: 40px; text-align: center;">
                            <div class="loader" style="margin: 0 auto 12px;"></div>
                            <span style="color: var(--text-secondary);">加载重仓股数据...</span>
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

        // 加载重仓股
        loadFundHoldings(fundCode);

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

        // 检查历史净值表首行是否为当日实际净值，如果是则同步更新头部日涨跌幅
        var est = await FundAPI.getRealtimeEstimate(fundCode);
        var actualToday = checkTodayActualNav(result, est);
        if (actualToday && !detailActualNavFound) {
            detailActualNavFound = true;
            updateDetailChangeRate(actualToday.change);
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

    // 加载基金重仓股
    async function loadFundHoldings(fundCode) {
        var wrap = document.getElementById('holdingsWrap');
        if (!wrap) return;

        var result = await FundAPI.getFundHoldings(fundCode);

        if (!result || !result.list || result.list.length === 0) {
            wrap.innerHTML = `
                <div class="empty-state" style="padding: 40px;">
                    <p>暂无重仓股数据</p>
                </div>
            `;
            return;
        }

        var reportDate = result.reportDate || '';
        var stockRatio = result.stockRatio || 0;

        // 计算资金流向汇总
        var totalMainFlow = result.list.reduce(function(sum, s) { return sum + (s.mainFlow || 0); }, 0);
        var flowUpCount = result.list.filter(function(s) { return (s.mainFlow || 0) > 0; }).length;
        var flowDownCount = result.list.filter(function(s) { return (s.mainFlow || 0) < 0; }).length;
        var flowClass = totalMainFlow >= 0 ? 'up' : 'down';

        var stockListHtml = result.list.map(function (stock, idx) {
            var ratioBar = stock.ratio > 0
                ? '<div class="ratio-bar"><div class="ratio-fill" style="width:' + Math.min(stock.ratio * 3, 100) + '%"></div></div>'
                : '';
            var changeClass = '';
            var changeText = stock.dayChange || '--';
            if (changeText.indexOf('-') === 0) changeClass = 'down';
            else if (changeText !== '--' && (changeText.indexOf('+') === 0 || parseFloat(changeText) > 0)) changeClass = 'up';

            var mfc = (stock.mainFlow || 0) >= 0 ? 'up' : 'down';
            var flowText = stock.mainFlow ? formatFlowMoney(stock.mainFlow) : '--';

            return `
                <tr>
                    <td class="holdings-rank">${idx + 1}</td>
                    <td>
                        <div class="holdings-stock">
                            <span class="stock-name">${stock.name || '--'}</span>
                            <span class="stock-code">${stock.code}</span>
                        </div>
                    </td>
                    <td class="num-cell">
                        <div class="ratio-cell">
                            <span class="ratio-text">${stock.ratio.toFixed(2)}%</span>
                            ${ratioBar}
                        </div>
                    </td>
                    <td class="num-cell">${stock.shares || '--'}</td>
                    <td class="num-cell">${stock.value || '--'}</td>
                    <td class="num-cell ${changeClass}">${changeText}</td>
                    <td class="num-cell ${mfc}">${flowText}</td>
                </tr>
            `;
        }).join('');

        wrap.innerHTML = `
            ${reportDate ? '<div class="holdings-meta">截至 <strong>' + reportDate + '</strong>' + (stockRatio > 0 ? ' · 股票占净比 <strong>' + stockRatio.toFixed(2) + '%</strong>' : '') + '</div>' : ''}
            <div class="holdings-flow-summary">
                <span class="hfs-item">重仓股主力净流入 <strong class="text-${flowClass}">${formatFlowMoney(totalMainFlow)}</strong></span>
                <span class="hfs-item text-up">流入 ${flowUpCount} 只</span>
                <span class="hfs-item text-down">流出 ${flowDownCount} 只</span>
            </div>
            <table class="fund-table holdings-table">
                <thead>
                    <tr>
                        <th style="width:36px;">#</th>
                        <th>股票名称</th>
                        <th class="text-right">占净值</th>
                        <th class="text-right">持股数(万股)</th>
                        <th class="text-right">持仓市值(万元)</th>
                        <th class="text-right">日涨跌幅</th>
                        <th class="text-right">主力资金流向</th>
                    </tr>
                </thead>
                <tbody>
                    ${stockListHtml}
                </tbody>
            </table>
        `;
    }

    // 实时更新详情中的估值
    var realtimeUpdateCount = 0; // 更新计数，用于控制历史净值检查频率
    function startRealtimeUpdate(fundCode) {
        if (realtimeTimer) clearInterval(realtimeTimer);
        realtimeUpdateCount = 0;
        realtimeTimer = setInterval(async function () {
            if (!detailModal.classList.contains('active') || currentDetailCode !== fundCode) {
                clearInterval(realtimeTimer);
                return;
            }

            var est = await FundAPI.getRealtimeEstimate(fundCode);
            if (!est) return;

            // 更新估值显示（盘中估值）
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

            // 每60秒（12次×5秒）检查一次历史净值表，看当日实际净值是否已公布
            realtimeUpdateCount++;
            if (!detailActualNavFound && realtimeUpdateCount % 12 === 0) {
                var histResult = await FundAPI.getHistoryNav(fundCode, 1, 1);
                var actualToday = checkTodayActualNav(histResult, est);
                if (actualToday) {
                    detailActualNavFound = true;
                    // 用实际涨跌幅更新头部日涨跌幅
                    updateDetailChangeRate(actualToday.change);
                    // 刷新历史净值表，显示最新数据
                    loadHistoryTable(fundCode);
                }
            }

            // 只有当日实际净值尚未公布时，才用实时估值更新日涨跌幅
            if (!detailActualNavFound) {
                updateDetailChangeRate(est.gszzl);
            }
        }, 5000); // 每5秒更新
    }

    // ========== 自选操作 ==========
    function handleFavToggle(btn) {
        if (!isLoggedIn()) {
            showToast('请先登录后再添加自选', 'warning');
            document.getElementById('loginBtn').click();
            return;
        }

        var code = btn.dataset.code;
        var name = btn.dataset.name;
        var type = btn.dataset.type;
        var action = btn.dataset.action;

        if (action === 'add') {
            var result = Store.addFavorite({ code: code, name: name, type: type });
            showToast(result.message, result.success ? 'success' : 'warning');
            if (result.success) {
                syncToServer('favorites');
                btn.dataset.action = 'remove';
                btn.textContent = '移除自选';
            }
        } else {
            Store.removeFavorite(code);
            showToast('已移除自选', 'success');
            syncToServer('favorites');
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
                var sfModal = document.getElementById('sectorFundsModal');
                if (sfModal && sfModal.style.display === 'flex') {
                    sfModal.style.display = 'none';
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

        // 板块基金弹窗关闭
        var sectorFundsModal = document.getElementById('sectorFundsModal');
        if (sectorFundsModal) {
            sectorFundsModal.addEventListener('click', function (e) {
                if (e.target === sectorFundsModal) {
                    sectorFundsModal.style.display = 'none';
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

    // ========== 首页股票行情看板 ==========
    var homeStockState = {
        fs: 'all', fid: 'f3', po: '1', page: 1, size: 15,
        keyword: '', loading: false, timer: null, requestId: 0
    };

    function loadHomeStockDashboard() {
        var container = document.getElementById('stockDashboard');
        if (!container) return;
        container.innerHTML = `
            <div class="home-stock-header">
                <div class="home-stock-tabs">
                    <span class="hst-tab ${homeStockState.fs==='all'?'active':''}" data-hfs="all">全部A股</span>
                    <span class="hst-tab ${homeStockState.fs==='sh'?'active':''}" data-hfs="sh">上证</span>
                    <span class="hst-tab ${homeStockState.fs==='sz'?'active':''}" data-hfs="sz">深证</span>
                    <span class="hst-tab ${homeStockState.fs==='cyb'?'active':''}" data-hfs="cyb">创业板</span>
                    <span class="hst-tab ${homeStockState.fs==='kcb'?'active':''}" data-hfs="kcb">科创板</span>
                </div>
                <div class="home-stock-sort">
                    <span class="hst-sort ${homeStockState.fid==='f3' && homeStockState.po==='1'?'active':''}" data-hfid="f3" data-hpo="1">📈 涨幅榜</span>
                    <span class="hst-sort ${homeStockState.fid==='f3' && homeStockState.po==='0'?'active':''}" data-hfid="f3" data-hpo="0">📉 跌幅榜</span>
                    <span class="hst-sort ${homeStockState.fid==='f6'?'active':''}" data-hfid="f6" data-hpo="1">💰 成交额</span>
                    <span class="hst-sort ${homeStockState.fid==='f62' && homeStockState.po==='1'?'active':''}" data-hfid="f62" data-hpo="1">🌊 主力流入</span>
                    <span class="hst-sort ${homeStockState.fid==='f62' && homeStockState.po==='0'?'active':''}" data-hfid="f62" data-hpo="0">🌊 主力流出</span>
                    <span class="hst-sort ${homeStockState.fid==='f8'?'active':''}" data-hfid="f8" data-hpo="1">🔄 换手率</span>
                </div>
            </div>
            <div class="home-stock-search">
                <input type="text" id="homeStockSearchInput" placeholder="搜索股票代码或名称..." value="${homeStockState.keyword}">
            </div>
            <div class="home-stock-stats" id="homeStockStats"></div>
            <div id="homeStockTable" style="min-height:180px;">
                <div style="padding:20px;text-align:center;color:var(--text-secondary)"><div class="loader" style="margin:0 auto 10px"></div>加载中...</div>
            </div>
            <div id="homeStockPagination"></div>
        `;
        _fetchHomeStocks();
        _bindHomeStockEvents();
        _startHomeStockAutoRefresh();
    }

    function _bindHomeStockEvents() {
        var container = document.getElementById('stockDashboard');
        if (!container) return;
        // 市场Tab
        container.querySelectorAll('[data-hfs]').forEach(function(el) {
            el.addEventListener('click', function() {
                homeStockState.fs = this.dataset.hfs;
                homeStockState.page = 1;
                _fetchHomeStocks();
                container.querySelectorAll('[data-hfs]').forEach(function(t) { t.classList.remove('active'); });
                this.classList.add('active');
            });
        });
        // 排序Tab
        container.querySelectorAll('[data-hfid]').forEach(function(el) {
            el.addEventListener('click', function() {
                homeStockState.fid = this.dataset.hfid;
                homeStockState.po = this.dataset.hpo;
                homeStockState.page = 1;
                _fetchHomeStocks();
                container.querySelectorAll('[data-hfid]').forEach(function(t) { t.classList.remove('active'); });
                this.classList.add('active');
            });
        });
        // 搜索
        var searchInput = document.getElementById('homeStockSearchInput');
        if (searchInput) {
            var searchTimer = null;
            searchInput.addEventListener('input', function() {
                clearTimeout(searchTimer);
                var val = this.value.trim();
                searchTimer = setTimeout(function() {
                    homeStockState.keyword = val;
                    homeStockState.page = 1;
                    _fetchHomeStocks();
                }, 300);
            });
        }
    }

    function _startHomeStockAutoRefresh() {
        if (homeStockState.timer) clearInterval(homeStockState.timer);
        homeStockState.timer = setInterval(function() {
            if (document.getElementById('homeStockTable')) {
                _fetchHomeStocks(true); // silent模式，不显示loading
            }
        }, 3000);
    }

    async function _fetchHomeStocks(silent) {
        if (homeStockState.loading) return;
        homeStockState.loading = true;
        var myReqId = ++homeStockState.requestId;

        var tableContainer = document.getElementById('homeStockTable');
        var statsContainer = document.getElementById('homeStockStats');
        var pagContainer = document.getElementById('homeStockPagination');
        if (!tableContainer) { homeStockState.loading = false; return; }
        if (!silent) {
            tableContainer.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)"><div class="loader" style="margin:0 auto 10px"></div>加载中...</div>';
            if (statsContainer) statsContainer.innerHTML = '';
            if (pagContainer) pagContainer.innerHTML = '';
        }

        try {
            var data = await FundAPI.getStockList({
                fs: homeStockState.fs, fid: homeStockState.fid, po: homeStockState.po,
                pn: homeStockState.page, pz: homeStockState.size, keyword: homeStockState.keyword
            });
            if (myReqId !== homeStockState.requestId) { homeStockState.loading = false; return; }

            var list = data.list || [];
            var total = data.total || 0;
            var totalPages = Math.ceil(total / homeStockState.size);

            if (list.length === 0) {
                tableContainer.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">暂无数据</div>';
                homeStockState.loading = false;
                return;
            }

            // 统计栏
            var upCount = 0, downCount = 0;
            var totalMainFlow = 0;
            list.forEach(function(item) {
                if (item.changePercent > 0) upCount++;
                else if (item.changePercent < 0) downCount++;
                totalMainFlow += (item.mainFlow || 0);
            });
            var mfc = totalMainFlow >= 0 ? 'up' : 'down';
            if (statsContainer) {
                statsContainer.innerHTML = '<span class="hst-stat">共 ' + total + ' 只</span>' +
                    '<span class="hst-stat up">涨 ' + upCount + '</span>' +
                    '<span class="hst-stat down">跌 ' + downCount + '</span>' +
                    '<span class="hst-stat ' + mfc + '">主力净流入 ' + formatFlowMoney(totalMainFlow) + '</span>' +
                    '<span class="hst-stat time">已更新 ' + new Date().toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit', second:'2-digit'}) + '</span>';
            }

            // 完整表格（横向滚动）
            var startRank = (homeStockState.page - 1) * homeStockState.size;
            var html = '<div style="overflow-x:auto;"><table class="home-stock-table"><thead><tr>' +
                '<th style="width:40px">#</th>' +
                '<th>代码</th><th>名称</th>' +
                '<th class="text-right">最新价</th>' +
                '<th class="text-right">涨跌幅</th>' +
                '<th class="text-right">成交额</th>' +
                '<th class="text-right">换手率</th>' +
                '<th class="text-right">主力净流入</th>' +
                '<th class="text-right">超大单</th>' +
                '<th class="text-right">大单</th>' +
                '<th class="text-right">中单</th>' +
                '<th class="text-right">小单</th>' +
                '</tr></thead><tbody>';
            list.forEach(function(item, idx) {
                var rank = startRank + idx + 1;
                var cc = item.changePercent >= 0 ? 'up' : item.changePercent < 0 ? 'down' : 'flat';
                var mfc = (item.mainFlow || 0) >= 0 ? 'up' : 'down';
                var rankClass = rank <= 3 ? 'rank-top' : '';
                html += '<tr class="home-stock-row" data-code="' + item.code + '" data-market="' + (item.market || (String(item.code).startsWith('6') ? '1' : '0')) + '">' +
                    '<td><span class="hst-rank ' + rankClass + '">' + rank + '</span></td>' +
                    '<td><span class="fund-code">' + item.code + '</span></td>' +
                    '<td class="hst-name">' + item.name + '</td>' +
                    '<td class="text-right hst-num">' + FundAPI.formatNum(item.price) + '</td>' +
                    '<td class="text-right"><span class="change-badge bg-' + cc + '">' + FundAPI.formatChange(item.changePercent) + '</span></td>' +
                    '<td class="text-right hst-num">' + formatFlowMoney(item.amount) + '</td>' +
                    '<td class="text-right hst-num">' + (item.turnover || 0).toFixed(2) + '%</td>' +
                    '<td class="text-right hst-num"><span class="text-' + mfc + '">' + formatFlowMoney(item.mainFlow) + '</span></td>' +
                    '<td class="text-right hst-num"><span class="text-' + ((item.superLargeFlow || 0) >= 0 ? 'up' : 'down') + '">' + formatFlowMoney(item.superLargeFlow) + '</span></td>' +
                    '<td class="text-right hst-num"><span class="text-' + ((item.largeFlow || 0) >= 0 ? 'up' : 'down') + '">' + formatFlowMoney(item.largeFlow) + '</span></td>' +
                    '<td class="text-right hst-num"><span class="text-' + ((item.mediumFlow || 0) >= 0 ? 'up' : 'down') + '">' + formatFlowMoney(item.mediumFlow) + '</span></td>' +
                    '<td class="text-right hst-num"><span class="text-' + ((item.smallFlow || 0) >= 0 ? 'up' : 'down') + '">' + formatFlowMoney(item.smallFlow) + '</span></td>' +
                    '</tr>';
            });
            html += '</tbody></table></div>';
            tableContainer.innerHTML = html;

            // 行点击跳转
            tableContainer.querySelectorAll('.home-stock-row').forEach(function(row) {
                row.style.cursor = 'pointer';
                row.addEventListener('click', function() {
                    var code = this.dataset.code;
                    var market = this.dataset.market;
                    location.hash = '/stock?code=' + code + '&market=' + market;
                });
            });

            // 分页
            _renderHomeStockPagination(total, totalPages);

        } catch (e) {
            console.warn('首页股票行情加载失败:', e);
            tableContainer.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">加载失败</div>';
        } finally {
            homeStockState.loading = false;
        }
    }

    function _renderHomeStockPagination(total, totalPages) {
        var pag = document.getElementById('homeStockPagination');
        if (!pag || totalPages <= 1) { if (pag) pag.innerHTML = ''; return; }
        var p = homeStockState.page, maxShow = 5;
        var startP = Math.max(1, p - Math.floor(maxShow / 2));
        var endP = Math.min(totalPages, startP + maxShow - 1);
        if (endP - startP < maxShow - 1) startP = Math.max(1, endP - maxShow + 1);

        var html = '<div class="ranking-pagination">';
        html += '<button class="pg-btn" data-hp="1" ' + (p <= 1 ? 'disabled' : '') + '>首页</button>';
        html += '<button class="pg-btn" data-hp="' + (p - 1) + '" ' + (p <= 1 ? 'disabled' : '') + '>上一页</button>';
        for (var i = startP; i <= endP; i++) {
            html += '<button class="pg-btn ' + (i === p ? 'active' : '') + '" data-hp="' + i + '">' + i + '</button>';
        }
        html += '<button class="pg-btn" data-hp="' + (p + 1) + '" ' + (p >= totalPages ? 'disabled' : '') + '>下一页</button>';
        html += '<button class="pg-btn" data-hp="' + totalPages + '" ' + (p >= totalPages ? 'disabled' : '') + '>末页</button>';
        html += '<span style="margin-left:10px;color:var(--text-tertiary);font-size:12px">共 ' + totalPages + ' 页</span>';
        html += '</div>';
        pag.innerHTML = html;

        pag.querySelectorAll('[data-hp]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (this.disabled) return;
                homeStockState.page = parseInt(this.dataset.hp);
                _fetchHomeStocks();
            });
        });
    }

    // ========== 股票行情 ==========
    var stockState = {
        fs: 'all', fid: 'f3', po: '1',
        page: 1, size: 50, keyword: '',
        loading: false, timer: null, requestId: 0,
    };

    function renderStockMarket() {
        var main = document.getElementById('app');
        if (!main) return;
        stockState.page = 1;
        stockState.requestId++;

        main.innerHTML = `
    <div class="stock-market-page">
        <div class="page-header">
            <h2 class="page-title">股票实时行情</h2>
            <p class="page-subtitle" style="font-size:13px;color:var(--text-secondary)">全市场A股实时行情 · 主力资金流向</p>
        </div>

        <div class="stock-filter-bar">
            <div class="stock-market-tabs">
                <span class="ranking-tab ${stockState.fs==='all'?'active':''}" data-fs="all">全部A股</span>
                <span class="ranking-tab ${stockState.fs==='sh'?'active':''}" data-fs="sh">上证</span>
                <span class="ranking-tab ${stockState.fs==='sz'?'active':''}" data-fs="sz">深证</span>
                <span class="ranking-tab ${stockState.fs==='cyb'?'active':''}" data-fs="cyb">创业板</span>
                <span class="ranking-tab ${stockState.fs==='kcb'?'active':''}" data-fs="kcb">科创板</span>
            </div>
            <div class="stock-sort-tabs">
                <span class="sort-tab ${stockState.fid==='f3' && stockState.po==='1'?'active':''}" data-fid="f3" data-po="1">涨幅榜</span>
                <span class="sort-tab ${stockState.fid==='f3' && stockState.po==='0'?'active':''}" data-fid="f3" data-po="0">跌幅榜</span>
                <span class="sort-tab ${stockState.fid==='f6'?'active':''}" data-fid="f6" data-po="1">成交额</span>
                <span class="sort-tab ${stockState.fid==='f62' && stockState.po==='1'?'active':''}" data-fid="f62" data-po="1">主力流入</span>
                <span class="sort-tab ${stockState.fid==='f62' && stockState.po==='0'?'active':''}" data-fid="f62" data-po="0">主力流出</span>
                <span class="sort-tab ${stockState.fid==='f8'?'active':''}" data-fid="f8" data-po="1">换手率</span>
            </div>
            <div class="stock-search-bar">
                <input type="text" class="stock-search-input" id="stockSearchInput" placeholder="搜索股票代码或名称..." value="${stockState.keyword}">
            </div>
        </div>

        <div id="stockTableContainer">
            <div style="padding:40px;text-align:center"><div class="loader" style="margin:0 auto 12px"></div>正在加载股票行情...</div>
        </div>
        <div id="stockPagination"></div>
        <div id="stockRefreshBar" class="ranking-info-bar" style="margin-top:12px"></div>
    </div>`;

        bindStockEvents();
        loadStockList();
        startStockAutoRefresh();
    }

    function bindStockEvents() {
        // 市场Tab
        document.querySelectorAll('.stock-market-tabs .ranking-tab').forEach(function(tab) {
            tab.addEventListener('click', function() {
                document.querySelectorAll('.stock-market-tabs .ranking-tab').forEach(function(t) { t.classList.remove('active'); });
                this.classList.add('active');
                stockState.fs = this.dataset.fs;
                stockState.page = 1;
                loadStockList();
            });
        });

        // 排序Tab
        document.querySelectorAll('.stock-sort-tabs .sort-tab').forEach(function(tab) {
            tab.addEventListener('click', function() {
                document.querySelectorAll('.stock-sort-tabs .sort-tab').forEach(function(t) { t.classList.remove('active'); });
                this.classList.add('active');
                stockState.fid = this.dataset.fid;
                stockState.po = this.dataset.po;
                stockState.page = 1;
                loadStockList();
            });
        });

        // 搜索
        var searchInput = document.getElementById('stockSearchInput');
        if (searchInput) {
            var searchTimer = null;
            searchInput.addEventListener('input', function() {
                clearTimeout(searchTimer);
                var val = this.value.trim();
                searchTimer = setTimeout(function() {
                    stockState.keyword = val;
                    stockState.page = 1;
                    loadStockList();
                }, 300);
            });
        }
    }

    async function loadStockList() {
        if (stockState.loading) return;
        stockState.loading = true;
        var myReqId = ++stockState.requestId;
        var container = document.getElementById('stockTableContainer');
        if (!container) { stockState.loading = false; return; }

        try {
            var data = await FundAPI.getStockList({
                fs: stockState.fs,
                fid: stockState.fid,
                po: stockState.po,
                pn: stockState.page,
                pz: stockState.size,
                keyword: stockState.keyword,
            });
            if (myReqId !== stockState.requestId) { stockState.loading = false; return; }

            var stocks = data.list || [];
            var total = data.total || 0;
            var totalPages = Math.ceil(total / stockState.size);

            if (stocks.length === 0) {
                container.innerHTML = '<div class="empty-state"><div class="icon">📊</div><h3>暂无数据</h3><p>未找到匹配的股票</p></div>';
            } else {
                renderStockTable(container, stocks);
                renderStockPagination(total, totalPages);
            }

            // 更新信息栏
            var infoBar = document.getElementById('stockRefreshBar');
            if (infoBar) {
                var upCount = stocks.filter(function(s) { return s.changePercent > 0; }).length;
                var downCount = stocks.filter(function(s) { return s.changePercent < 0; }).length;
                var totalMainFlow = stocks.reduce(function(sum, s) { return sum + (s.mainFlow || 0); }, 0);
                infoBar.innerHTML = '共 ' + total + ' 只股票 | 涨 <span class="text-up">' + upCount + '</span> | 跌 <span class="text-down">' + downCount + '</span> | 主力净流入 <span class="' + (totalMainFlow >= 0 ? 'text-up' : 'text-down') + '">' + formatFlowMoney(totalMainFlow) + '</span> | 已更新 ' + FundAPI.formatDate(new Date(), 'HH:mm:ss');
            }
        } catch (e) {
            console.warn('加载股票列表失败:', e);
        } finally {
            stockState.loading = false;
        }
    }

    function renderStockTable(container, stocks) {
        var startRank = (stockState.page - 1) * stockState.size;
        var html = '<div class="stock-table-wrap"><table class="fund-table stock-table"><thead><tr>' +
            '<th style="width:50px">#</th>' +
            '<th>代码</th><th>名称</th>' +
            '<th class="text-right">最新价</th>' +
            '<th class="text-right">涨跌幅</th>' +
            '<th class="text-right">成交额</th>' +
            '<th class="text-right">换手率</th>' +
            '<th class="text-right">主力净流入</th>' +
            '<th class="text-right">超大单</th>' +
            '<th class="text-right">大单</th>' +
            '<th class="text-right">中单</th>' +
            '<th class="text-right">小单</th>' +
            '</tr></thead><tbody>';

        stocks.forEach(function(s, i) {
            var rank = startRank + i + 1;
            var cc = s.changePercent >= 0 ? 'up' : s.changePercent < 0 ? 'down' : 'flat';
            var mfc = s.mainFlow >= 0 ? 'up' : 'down';
            html += '<tr class="stock-row" data-code="' + s.code + '" data-market="' + (s.market || (s.code.startsWith('6') ? '1' : '0')) + '">' +
                '<td class="rank-cell">' + rank + '</td>' +
                '<td><span class="fund-code">' + s.code + '</span></td>' +
                '<td class="fund-name-cell"><span class="fund-name">' + s.name + '</span></td>' +
                '<td class="text-right num-cell">' + FundAPI.formatNum(s.price) + '</td>' +
                '<td class="text-right"><span class="change-badge bg-' + cc + '">' + FundAPI.formatChange(s.changePercent) + '</span></td>' +
                '<td class="text-right num-cell">' + formatFlowMoney(s.amount) + '</td>' +
                '<td class="text-right num-cell">' + (s.turnover || 0).toFixed(2) + '%</td>' +
                '<td class="text-right num-cell"><span class="text-' + mfc + '">' + formatFlowMoney(s.mainFlow) + '</span></td>' +
                '<td class="text-right num-cell"><span class="text-' + (s.superLargeFlow >= 0 ? 'up' : 'down') + '">' + formatFlowMoney(s.superLargeFlow) + '</span></td>' +
                '<td class="text-right num-cell"><span class="text-' + (s.largeFlow >= 0 ? 'up' : 'down') + '">' + formatFlowMoney(s.largeFlow) + '</span></td>' +
                '<td class="text-right num-cell"><span class="text-' + (s.mediumFlow >= 0 ? 'up' : 'down') + '">' + formatFlowMoney(s.mediumFlow) + '</span></td>' +
                '<td class="text-right num-cell"><span class="text-' + (s.smallFlow >= 0 ? 'up' : 'down') + '">' + formatFlowMoney(s.smallFlow) + '</span></td>' +
                '</tr>';
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;

        // 行点击事件
        container.querySelectorAll('.stock-row').forEach(function(row) {
            row.style.cursor = 'pointer';
            row.addEventListener('click', function() {
                var code = this.dataset.code;
                var market = this.dataset.market;
                location.hash = '/stock?code=' + code + '&market=' + market;
            });
        });
    }

    function renderStockPagination(total, totalPages) {
        var pag = document.getElementById('stockPagination');
        if (!pag) return;
        var p = stockState.page, maxShow = 5;
        var startP = Math.max(1, p - Math.floor(maxShow / 2));
        var endP = Math.min(totalPages, startP + maxShow - 1);
        if (endP - startP < maxShow - 1) startP = Math.max(1, endP - maxShow + 1);

        var html = '<div class="ranking-pagination">';
        html += '<button class="pg-btn" data-p="1" ' + (p <= 1 ? 'disabled' : '') + '>首页</button>';
        html += '<button class="pg-btn" data-p="' + (p - 1) + '" ' + (p <= 1 ? 'disabled' : '') + '>上一页</button>';
        for (var i = startP; i <= endP; i++) {
            html += '<button class="pg-btn ' + (i === p ? 'active' : '') + '" data-p="' + i + '">' + i + '</button>';
        }
        html += '<button class="pg-btn" data-p="' + (p + 1) + '" ' + (p >= totalPages ? 'disabled' : '') + '>下一页</button>';
        html += '<button class="pg-btn" data-p="' + totalPages + '" ' + (p >= totalPages ? 'disabled' : '') + '>末页</button>';
        html += '<span style="margin-left:12px;color:var(--text-secondary);font-size:13px">共 ' + totalPages + ' 页</span>';
        html += '</div>';
        pag.innerHTML = html;

        pag.querySelectorAll('.pg-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var newP = parseInt(this.dataset.p);
                if (newP >= 1 && newP <= totalPages && newP !== stockState.page) {
                    stockState.page = newP;
                    loadStockList();
                    document.getElementById('stockTableContainer').scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
    }

    function startStockAutoRefresh() {
        if (stockState.timer) clearInterval(stockState.timer);
        stockState.timer = setInterval(function() {
            if (document.querySelector('.stock-market-page')) {
                loadStockList();
            } else {
                clearInterval(stockState.timer);
                stockState.timer = null;
            }
        }, 15000);
    }

    function formatFlowMoney(val) {
        if (val === undefined || val === null || val === 0) return '0';
        var abs = Math.abs(val);
        var sign = val >= 0 ? '+' : '';
        if (abs >= 100000000) return sign + (abs / 100000000).toFixed(2) + '亿';
        if (abs >= 10000) return sign + (abs / 10000).toFixed(2) + '万';
        return sign + abs.toFixed(0);
    }

    // ========== 个股详情 ==========
    function renderStockDetail(secid) {
        var main = document.getElementById('app');
        if (!main) return;

        main.innerHTML = `
    <div class="stock-detail-page">
        <div class="detail-back-btn" onclick="location.hash='/stocks'">
            <span style="font-size:20px">&#8592;</span> 返回股票列表
        </div>
        <div id="stockDetailContent">
            <div style="padding:80px;text-align:center"><div class="loader" style="margin:0 auto 16px"></div><p style="color:var(--text-secondary)">正在加载股票详情...</p></div>
        </div>
    </div>`;

        loadStockDetailData(secid);
    }

    async function loadStockDetailData(secid) {
        var container = document.getElementById('stockDetailContent');
        if (!container) return;

        try {
            var [detail, flow] = await Promise.all([
                FundAPI.getStockDetail(secid),
                FundAPI.getStockFlow(secid),
            ]);

            if (!detail) {
                container.innerHTML = '<div class="empty-state"><div class="icon">&#128564;</div><h3>加载失败</h3><p>无法获取该股票数据</p></div>';
                return;
            }

            var cc = detail.changePercent >= 0 ? 'up' : 'down';
            var mfc = (detail.mainFlow || 0) >= 0 ? 'up' : 'down';
            // 散户 = 中单 + 小单
            var retailFlow = (detail.mediumFlow || 0) + (detail.smallFlow || 0);
            var retailIn = (detail.mediumIn || 0) + (detail.smallIn || 0);
            var retailOut = (detail.mediumOut || 0) + (detail.smallOut || 0);
            var rfc = retailFlow >= 0 ? 'up' : 'down';
            var code = detail.code;
            var market = detail.market || '1';

            container.innerHTML = `
        <div class="detail-header">
            <div class="detail-title-row">
                <span class="detail-fund-name">${detail.name}</span>
                <span class="detail-fund-code">${code}</span>
                <span class="change-badge bg-${cc}" style="font-size:16px;padding:4px 12px">${FundAPI.formatChange(detail.changePercent)}</span>
            </div>
            <div class="detail-metrics">
                <div class="metric-item">
                    <div class="metric-label">最新价</div>
                    <div class="metric-value ${cc === 'up' ? 'text-up' : 'text-down'}">${FundAPI.formatNum(detail.price)}</div>
                    <div class="metric-sub ${cc === 'up' ? 'text-up' : 'text-down'}">${(detail.changeAmount || 0) >= 0 ? '+' : ''}${(detail.changeAmount || 0).toFixed(2)}</div>
                </div>
                <div class="metric-item">
                    <div class="metric-label">今开</div>
                    <div class="metric-value">${FundAPI.formatNum(detail.open)}</div>
                    <div class="metric-sub">昨收 ${FundAPI.formatNum(detail.prevClose)}</div>
                </div>
                <div class="metric-item">
                    <div class="metric-label">最高</div>
                    <div class="metric-value text-up">${FundAPI.formatNum(detail.high)}</div>
                    <div class="metric-sub text-down">最低 ${FundAPI.formatNum(detail.low)}</div>
                </div>
                <div class="metric-item">
                    <div class="metric-label">成交额</div>
                    <div class="metric-value">${formatFlowMoney(detail.amount)}</div>
                    <div class="metric-sub">换手 ${((detail.turnover || 0)).toFixed(2)}%</div>
                </div>
                <div class="metric-item">
                    <div class="metric-label">总市值</div>
                    <div class="metric-value">${formatFlowMoney(detail.totalMarketCap)}</div>
                    <div class="metric-sub">流通 ${formatFlowMoney(detail.floatMarketCap)}</div>
                </div>
            </div>
        </div>

        <div class="detail-body" style="padding:0 16px 32px">
            <div class="detail-section" style="margin-bottom:20px">
                <div class="detail-section-title"><span>&#128176;</span> 资金流向</div>
                <div class="stock-flow-grid">
                    <div class="stock-flow-card ${mfc === 'up' ? 'flow-positive' : 'flow-negative'}">
                        <div class="flow-label">主力净流入</div>
                        <div class="flow-value ${mfc === 'up' ? 'text-up' : 'text-down'}">${formatFlowMoney(detail.mainFlow)}</div>
                        <div class="flow-sub">流入 ${formatFlowMoney(detail.mainIn)} / 流出 ${formatFlowMoney(detail.mainOut)}</div>
                    </div>
                    <div class="stock-flow-card ${rfc === 'up' ? 'flow-positive' : 'flow-negative'}">
                        <div class="flow-label">散户净流入</div>
                        <div class="flow-value ${rfc === 'up' ? 'text-up' : 'text-down'}">${formatFlowMoney(retailFlow)}</div>
                        <div class="flow-sub">流入 ${formatFlowMoney(retailIn)} / 流出 ${formatFlowMoney(retailOut)}</div>
                    </div>
                    <div class="stock-flow-card">
                        <div class="flow-label">超大单</div>
                        <div class="flow-value ${(detail.superLargeFlow || 0) >= 0 ? 'text-up' : 'text-down'}">${formatFlowMoney(detail.superLargeFlow)}</div>
                        <div class="flow-sub">流入 ${formatFlowMoney(detail.superLargeIn)} / 流出 ${formatFlowMoney(detail.superLargeOut)}</div>
                    </div>
                    <div class="stock-flow-card">
                        <div class="flow-label">大单</div>
                        <div class="flow-value ${(detail.largeFlow || 0) >= 0 ? 'text-up' : 'text-down'}">${formatFlowMoney(detail.largeFlow)}</div>
                        <div class="flow-sub">流入 ${formatFlowMoney(detail.largeIn)} / 流出 ${formatFlowMoney(detail.largeOut)}</div>
                    </div>
                    <div class="stock-flow-card">
                        <div class="flow-label">中单</div>
                        <div class="flow-value ${(detail.mediumFlow || 0) >= 0 ? 'text-up' : 'text-down'}">${formatFlowMoney(detail.mediumFlow)}</div>
                        <div class="flow-sub">流入 ${formatFlowMoney(detail.mediumIn)} / 流出 ${formatFlowMoney(detail.mediumOut)}</div>
                    </div>
                    <div class="stock-flow-card">
                        <div class="flow-label">小单</div>
                        <div class="flow-value ${(detail.smallFlow || 0) >= 0 ? 'text-up' : 'text-down'}">${formatFlowMoney(detail.smallFlow)}</div>
                        <div class="flow-sub">流入 ${formatFlowMoney(detail.smallIn)} / 流出 ${formatFlowMoney(detail.smallOut)}</div>
                    </div>
                </div>
            </div>

            <div class="detail-section">
                <div class="detail-section-title"><span>&#128200;</span> 分时资金流向</div>
                <div id="stockFlowChart" style="width:100%;height:350px"></div>
            </div>
        </div>`;

            // 绘制分时资金流向图
            if (flow && flow.timeline && flow.timeline.length > 0) {
                renderStockFlowChart(flow.timeline);
            }
        } catch (e) {
            console.warn('加载股票详情失败:', e);
        }
    }

    function renderStockFlowChart(timeline) {
        var chartEl = document.getElementById('stockFlowChart');
        if (!chartEl) return;
        // 等ECharts加载
        if (typeof echarts === 'undefined') {
            var checkTimer = setInterval(function() {
                if (typeof echarts !== 'undefined') {
                    clearInterval(checkTimer);
                    _drawStockFlowChart(chartEl, timeline);
                }
            }, 500);
            setTimeout(function() { clearInterval(checkTimer); }, 10000);
        } else {
            _drawStockFlowChart(chartEl, timeline);
        }
    }

    function _drawStockFlowChart(el, timeline) {
        var chart = echarts.init(el);
        var times = [], mainInData = [], mainOutData = [], retailInData = [], retailOutData = [];
        timeline.forEach(function(item) {
            var t = item.date || item.time || '';
            if (t.length === 8 && t.indexOf(':') > 0) t = t.substring(0, 5);
            times.push(t);
            // 主力 = 超大单 + 大单, 散户 = 中单 + 小单
            var mainIn = (parseFloat(item.superLargeIn || 0) + parseFloat(item.largeIn || 0)) / 10000;
            var mainOut = -(parseFloat(item.superLargeOut || 0) + parseFloat(item.largeOut || 0)) / 10000;
            var retailIn = (parseFloat(item.mediumIn || 0) + parseFloat(item.smallIn || 0)) / 10000;
            var retailOut = -(parseFloat(item.mediumOut || 0) + parseFloat(item.smallOut || 0)) / 10000;
            mainInData.push(mainIn.toFixed(2));
            mainOutData.push(mainOut.toFixed(2));
            retailInData.push(retailIn.toFixed(2));
            retailOutData.push(retailOut.toFixed(2));
        });

        chart.setOption({
            tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, formatter: function(params) {
                var result = params[0].axisValue + '<br/>';
                params.forEach(function(p) {
                    var val = parseFloat(p.value);
                    var dir = val > 0 ? '流入' : '流出';
                    result += '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + p.color + ';margin-right:5px;"></span>' + p.seriesName + dir + ': ' + Math.abs(val).toFixed(2) + ' 万元<br/>';
                });
                return result;
            }},
            legend: { data: ['主力流入', '主力流出', '散户流入', '散户流出'], top: 0, textStyle: { fontSize: 11 } },
            grid: { left: 60, right: 20, top: 35, bottom: 30 },
            xAxis: { type: 'category', data: times, axisLabel: { fontSize: 11 } },
            yAxis: { type: 'value', name: '万元', axisLabel: { fontSize: 11 }, splitLine: { lineStyle: { type: 'dashed' } } },
            series: [
                { name: '主力流入', type: 'line', data: mainInData, smooth: true, lineStyle: { color: '#ef4444', width: 2.5 }, itemStyle: { color: '#ef4444' }, symbol: 'circle', symbolSize: 4, areaStyle: { color: 'rgba(239,68,68,0.06)' } },
                { name: '主力流出', type: 'line', data: mainOutData, smooth: true, lineStyle: { color: '#b91c1c', width: 2 }, itemStyle: { color: '#b91c1c' }, symbol: 'circle', symbolSize: 4, areaStyle: { color: 'rgba(185,28,28,0.06)' } },
                { name: '散户流入', type: 'line', data: retailInData, smooth: true, lineStyle: { color: '#22c55e', width: 2 }, itemStyle: { color: '#22c55e' }, symbol: 'circle', symbolSize: 4, areaStyle: { color: 'rgba(34,197,94,0.06)' } },
                { name: '散户流出', type: 'line', data: retailOutData, smooth: true, lineStyle: { color: '#15803d', width: 2 }, itemStyle: { color: '#15803d' }, symbol: 'circle', symbolSize: 4, areaStyle: { color: 'rgba(21,128,61,0.06)' } },
            ]
        });
        window.addEventListener('resize', function() { chart.resize(); });
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
            el.textContent = T('text_footer_time_prefix', '当前时间: ') + FundAPI.formatDate(new Date(), 'YYYY-MM-DD HH:mm:ss');
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
        // 登录成功后从服务端同步数据
        syncFromServer();
    }

    function clearLoginState() {
        localStorage.removeItem('fund_user');
        // 退出登录时清除当前显示的持仓和自选数据
        localStorage.removeItem('fund_favorites');
        localStorage.removeItem('fund_fav_groups');
        localStorage.removeItem('fund_holdings');
        updateLoginUI();
        // 如果当前在持仓或自选页面，跳回首页
        var hash = location.hash;
        if (hash.indexOf('/portfolio') !== -1 || hash.indexOf('/favorites') !== -1) {
            navigate('/');
        } else {
            router();
        }
    }

    function isLoggedIn() {
        var user = getLoginState();
        return !!(user && user.token && user.username);
    }

    function getAuthHeaders() {
        var user = getLoginState();
        if (user && user.token) {
            return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + user.token };
        }
        return { 'Content-Type': 'application/json' };
    }

    // 登录后从服务端同步自选和持仓到本地
    function syncFromServer() {
        if (!isLoggedIn()) return;
        // 先验证token是否有效
        fetch('/api/auth/verify', {
            method: 'POST',
            headers: getAuthHeaders()
        }).then(function (r) { return r.json(); }).then(function (verifyData) {
            if (!verifyData.success) {
                // token失效，清除登录状态
                clearLoginState();
                showToast('登录已过期，请重新登录', 'warning');
                return;
            }
            // token有效，同步数据
            return Promise.all([
                fetch('/api/user/favorites', { headers: getAuthHeaders() }).then(function (r) { return r.json(); }),
                fetch('/api/user/holdings', { headers: getAuthHeaders() }).then(function (r) { return r.json(); })
            ]).then(function (results) {
                var favData = results[0];
                var holdData = results[1];
                if (favData.success && favData.favorites) {
                    localStorage.setItem('fund_favorites', JSON.stringify(favData.favorites));
                }
                if (favData.success && favData.groups) {
                    localStorage.setItem('fund_fav_groups', JSON.stringify(favData.groups));
                }
                if (holdData.success && holdData.holdings) {
                    localStorage.setItem('fund_holdings', JSON.stringify(holdData.holdings));
                }
                // 刷新当前页面
                if (typeof router === 'function') router();
            });
        }).catch(function (e) { console.error('同步数据失败:', e); });
    }

    // 本地数据变化后同步到服务端
    function syncToServer(type) {
        if (!isLoggedIn()) return;
        if (type === 'favorites') {
            fetch('/api/user/favorites', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    favorites: Store.getFavorites(),
                    groups: Store.getGroups()
                })
            }).catch(function (e) { console.error('同步自选失败:', e); });
        } else if (type === 'holdings') {
            fetch('/api/user/holdings', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ holdings: Store.getHoldings() })
            }).catch(function (e) { console.error('同步持仓失败:', e); });
        }
    }

    function updateLoginUI() {
        var user = getLoginState();
        var userArea = document.getElementById('userArea');
        if (!userArea) return;
        if (user && user.username) {
            userArea.innerHTML = '<span class="user-phone">' + user.username + '</span><button class="logout-btn" id="logoutBtn">退出</button>';
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
                <div class="login-icon">🔐</div>
                <h3 id="authTitle">登录</h3>
                <p id="authSubtitle">账号密码登录</p>
            </div>
            <div class="login-tabs">
                <span class="login-tab active" data-mode="login">登录</span>
                <span class="login-tab" data-mode="register">注册</span>
            </div>
            <div class="login-body">
                <div class="form-group">
                    <label class="form-label">用户名 <span class="required">*</span></label>
                    <input type="text" class="form-input" id="authUsername" placeholder="3-20位字母/数字/中文" autocomplete="username">
                </div>
                <div class="form-group">
                    <label class="form-label">密码 <span class="required">*</span></label>
                    <input type="password" class="form-input" id="authPassword" placeholder="至少6位" autocomplete="current-password">
                </div>
                <div class="form-group" id="confirmGroup" style="display:none;">
                    <label class="form-label">确认密码 <span class="required">*</span></label>
                    <input type="password" class="form-input" id="authConfirm" placeholder="再次输入密码" autocomplete="new-password">
                </div>
                <div class="form-actions">
                    <button class="form-cancel" id="loginCancelBtn">取消</button>
                    <button class="form-submit" id="loginSubmitBtn">登录</button>
                </div>
                <p class="login-tip" id="authTip">登录后可使用持仓和自选功能，数据云端保存</p>
            </div>
        `;
        loginModal.classList.add('active');

        var mode = 'login';

        // Tab切换
        loginFormContent.querySelectorAll('.login-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                mode = this.dataset.mode;
                loginFormContent.querySelectorAll('.login-tab').forEach(function (t) { t.classList.remove('active'); });
                this.classList.add('active');
                if (mode === 'register') {
                    document.getElementById('authTitle').textContent = '注册';
                    document.getElementById('authSubtitle').textContent = '创建新账号';
                    document.getElementById('confirmGroup').style.display = '';
                    document.getElementById('loginSubmitBtn').textContent = '注册';
                    document.getElementById('authTip').textContent = '注册后数据云端保存，网站更新不影响您的数据';
                } else {
                    document.getElementById('authTitle').textContent = '登录';
                    document.getElementById('authSubtitle').textContent = '账号密码登录';
                    document.getElementById('confirmGroup').style.display = 'none';
                    document.getElementById('loginSubmitBtn').textContent = '登录';
                    document.getElementById('authTip').textContent = '登录后可使用持仓和自选功能，数据云端保存';
                }
            });
        });

        document.getElementById('loginCancelBtn').addEventListener('click', function () {
            loginModal.classList.remove('active');
        });

        document.getElementById('loginSubmitBtn').addEventListener('click', function () {
            if (mode === 'register') {
                doRegister();
            } else {
                doLogin();
            }
        });

        document.getElementById('authPassword').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                if (mode === 'register') {
                    document.getElementById('authConfirm').focus();
                } else {
                    doLogin();
                }
            }
        });
        document.getElementById('authConfirm').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') doRegister();
        });
    }

    function doRegister() {
        var username = document.getElementById('authUsername').value.trim();
        var password = document.getElementById('authPassword').value.trim();
        var confirm = document.getElementById('authConfirm').value.trim();

        if (!username) { showToast('请输入用户名', 'warning'); return; }
        if (username.length < 3 || username.length > 20) { showToast('用户名长度需3-20个字符', 'warning'); return; }
        if (!password) { showToast('请输入密码', 'warning'); return; }
        if (password.length < 6) { showToast('密码长度至少6位', 'warning'); return; }
        if (password !== confirm) { showToast('两次密码不一致', 'warning'); return; }

        var btn = document.getElementById('loginSubmitBtn');
        btn.disabled = true;
        btn.textContent = '注册中...';

        fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        }).then(function (r) { return r.json(); }).then(function (data) {
            btn.disabled = false;
            btn.textContent = '注册';
            if (data.success) {
                setLoginState({ username: data.username, token: data.token, loginTime: Date.now() });
                showToast('注册成功，已自动登录', 'success');
                loginModal.classList.remove('active');
            } else {
                showToast(data.message || '注册失败', 'error');
            }
        }).catch(function (e) {
            btn.disabled = false;
            btn.textContent = '注册';
            showToast('网络错误，请重试', 'error');
        });
    }

    function doLogin() {
        var username = document.getElementById('authUsername').value.trim();
        var password = document.getElementById('authPassword').value.trim();
        if (!username) { showToast('请输入用户名', 'warning'); return; }
        if (!password) { showToast('请输入密码', 'warning'); return; }

        var btn = document.getElementById('loginSubmitBtn');
        btn.disabled = true;
        btn.textContent = '登录中...';

        fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        }).then(function (r) { return r.json(); }).then(function (data) {
            btn.disabled = false;
            btn.textContent = '登录';
            if (data.success) {
                setLoginState({ username: data.username, token: data.token, loginTime: Date.now() });
                showToast('登录成功', 'success');
                loginModal.classList.remove('active');
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
        // 先渲染页面(使用默认文案),再异步加载站点配置覆盖
        if (isLoggedIn()) {
            syncFromServer();
        }
        router();
        updateFooterTime();
        setInterval(updateFooterTime, 1000);
        loadAnnouncements();
        // 异步加载站点配置,不阻塞首屏渲染
        loadSiteConfig(function () {
            // 配置加载完成后重新渲染当前页面以应用文案
            updateFooterTime();
        });
    }

    // DOM加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
