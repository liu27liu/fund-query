/**
 * 后台管理前端逻辑
 * 基金净值通 · 管理控制台
 */
(function () {
'use strict';

// ========== 全局状态 ==========
var TOKEN_KEY = 'admin_token';
var ADMIN_KEY = 'admin_info';
var API_BASE = '/admin/api';
var token = localStorage.getItem(TOKEN_KEY) || '';
var adminInfo = JSON.parse(localStorage.getItem(ADMIN_KEY) || 'null');
var menus = [];
var currentPage = 1;

// ========== API 辅助 ==========
function api(path, method, data) {
    method = method || 'GET';
    var opts = {
        method: method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (data && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
        opts.body = JSON.stringify(data);
    }
    return fetch(API_BASE + path, opts).then(function (r) {
        if (r.status === 401) { logout(); throw new Error('未登录'); }
        return r.json();
    });
}

function showToast(msg, type) {
    type = type || 'info';
    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    document.getElementById('toastContainer').appendChild(el);
    setTimeout(function () { el.remove(); }, 3000);
}

function fmtTime(ts) {
    if (!ts) return '-';
    var d = new Date(ts * 1000);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
        pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}
function pad(n) { return n < 10 ? '0' + n : '' + n; }

function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 分页渲染
function renderPagination(total, page, size, onPage) {
    var pages = Math.ceil(total / size);
    if (pages <= 1) return '';
    var html = '<div class="pagination">';
    html += '<button onclick="' + onPage + '(' + (page - 1) + ')" ' + (page <= 1 ? 'disabled' : '') + '>上一页</button>';
    var start = Math.max(1, page - 2);
    var end = Math.min(pages, page + 2);
    for (var i = start; i <= end; i++) {
        html += '<button class="' + (i === page ? 'active' : '') + '" onclick="' + onPage + '(' + i + ')">' + i + '</button>';
    }
    html += '<span class="page-info">共 ' + total + ' 条 / ' + pages + ' 页</span>';
    html += '<button onclick="' + onPage + '(' + (page + 1) + ')" ' + (page >= pages ? 'disabled' : '') + '>下一页</button>';
    html += '</div>';
    return html;
}

// 通用弹窗
function openModal(title, bodyHtml, footerHtml) {
    document.getElementById('genericModalTitle').textContent = title;
    document.getElementById('genericModalBody').innerHTML = bodyHtml;
    document.getElementById('genericModalFooter').innerHTML = footerHtml || '<button class="btn-default" onclick="document.getElementById(\'genericModal\').style.display=\'none\'">关闭</button>';
    document.getElementById('genericModal').style.display = 'flex';
}
function closeModal() {
    document.getElementById('genericModal').style.display = 'none';
}

// ========== 认证 ==========
function login() {
    var username = document.getElementById('loginUsername').value.trim();
    var password = document.getElementById('loginPassword').value.trim();
    if (!username || !password) { showToast('请输入用户名和密码', 'error'); return; }
    fetch(API_BASE + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
    }).then(function (r) { return r.json(); }).then(function (res) {
        if (res.success) {
            token = res.token;
            adminInfo = res.admin;
            localStorage.setItem(TOKEN_KEY, token);
            localStorage.setItem(ADMIN_KEY, JSON.stringify(adminInfo));
            showMain();
        } else {
            showToast(res.message || '登录失败', 'error');
        }
    }).catch(function (e) { showToast('网络错误', 'error'); });
}

function logout() {
    token = '';
    adminInfo = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADMIN_KEY);
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('mainLayout').style.display = 'none';
}

function showMain() {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('mainLayout').style.display = 'flex';
    document.getElementById('adminInfo').textContent = adminInfo.username + ' (' + (adminInfo.role || '') + ')';
    loadMenu();
}

function verifyToken() {
    if (!token) { return; }
    api('/auth/verify', 'POST').then(function (res) {
        if (res.success) {
            adminInfo = res.admin;
            localStorage.setItem(ADMIN_KEY, JSON.stringify(adminInfo));
            showMain();
        } else {
            logout();
        }
    }).catch(function () { logout(); });
}

// ========== 菜单 ==========
function loadMenu() {
    api('/menu').then(function (res) {
        if (res.success) {
            menus = res.list;
            renderMenu();
            // 默认路由
            var hash = location.hash.slice(1) || 'dashboard';
            if (!menus.find(function (m) { return m.key === hash; })) {
                hash = menus.length ? menus[0].key : 'dashboard';
            }
            router();
        }
    }).catch(function () {});
}

var iconMap = {
    dashboard: '📊', users: '👥', admin: '⚙️', fund: '💰', chart: '📈',
    star: '⭐', search: '🔍', task: '🔄', database: '🗄️', server: '🖥️',
    setting: '🔧', log: '📝'
};

function renderMenu() {
    var html = '';
    menus.forEach(function (m) {
        html += '<div class="menu-item" data-key="' + m.key + '" onclick="navigate(\'' + m.key + '\')">' +
            '<span class="menu-icon">' + (iconMap[m.icon] || '📋') + '</span>' +
            '<span>' + m.title + '</span></div>';
    });
    document.getElementById('sidebarMenu').innerHTML = html;
}

function navigate(key) {
    location.hash = key;
}

function router() {
    var hash = location.hash.slice(1) || 'dashboard';
    var menu = menus.find(function (m) { return m.key === hash; });
    if (!menu) { hash = 'dashboard'; menu = menus[0]; }
    
    // 更新菜单高亮
    document.querySelectorAll('.menu-item').forEach(function (el) {
        el.classList.toggle('active', el.dataset.key === hash);
    });
    document.getElementById('pageTitle').textContent = menu ? menu.title : '系统仪表盘';
    document.getElementById('pageContent').innerHTML = '<div class="loading-state">加载中...</div>';
    currentPage = 1;

    // 路由分发
    switch (hash) {
        case 'dashboard': renderDashboard(); break;
        case 'users': renderSiteUsers(1); break;
        case 'admins': renderAdmins(1); break;
        case 'funds': renderFunds(1); break;
        case 'nav': renderNavMonitor(); break;
        case 'favorites': renderFavoritesStats(); break;
        case 'search_stats': renderSearchStats(); break;
        case 'tasks': renderTasks(); break;
        case 'sources': renderDataSources(); break;
        case 'cache': renderCacheStatus(); break;
        case 'config': renderConfig(); break;
        case 'logs': renderLogs(); break;
        default: renderDashboard();
    }
}

window.addEventListener('hashchange', router);

// ========== 1. 仪表盘 ==========
function renderDashboard() {
    api('/dashboard').then(function (res) {
        if (!res.success) return;
        var d = res.data;
        var html = '<div class="stat-grid">';
        html += statCard('网站注册用户', d.site_user_count, 'primary', '累计注册');
        html += statCard('今日搜索量', d.search_today, 'primary', '总计 ' + d.search_total);
        html += statCard('今日登录次数', d.login_today, 'success', '失败 ' + d.login_fail);
        html += statCard('今日操作数', d.op_today, '', '操作日志');
        html += statCard('自选总数', d.fav_total, '', d.unique_funds || 0 + ' 只基金被自选');
        html += statCard('持仓总数', d.holding_total, '', '用户持仓记录');
        html += statCard('基金缓存数', d.fund_cached, '', '已缓存基金数据');
        html += statCard('采集任务', d.task_active + '/' + d.task_total, d.task_active > 0 ? 'success' : 'warning', '启用/总数');
        html += statCard('今日采集', d.coll_today, d.coll_fail > 0 ? 'warning' : 'success', '失败 ' + d.coll_fail);
        html += statCard('数据源', d.ds_active + '/' + ds_total_text(d), '', '启用/总数');
        html += statCard('管理员', d.admin_count, '', '活跃管理员');
        html += statCard('系统运行时长', d.uptime_str, '', '自上次重启');
        html += '</div>';

        // 搜索趋势图表
        html += '<div class="card"><div class="card-title">最近7天搜索趋势</div><div class="chart-container" id="searchTrendChart"></div></div>';

        // 最近操作
        html += '<div class="card"><div class="card-title">最近操作日志</div><table class="data-table"><thead><tr><th>时间</th><th>管理员</th><th>模块</th><th>操作</th><th>详情</th></tr></thead><tbody>';
        if (d.recent_ops && d.recent_ops.length) {
            d.recent_ops.forEach(function (op) {
                html += '<tr><td>' + escapeHtml(op.time_str) + '</td><td>' + escapeHtml(op.username) + '</td><td>' + escapeHtml(op.module) + '</td><td>' + escapeHtml(op.action) + '</td><td>' + escapeHtml(op.detail) + '</td></tr>';
            });
        } else {
            html += '<tr><td colspan="5" class="text-center" style="color:#999;padding:20px;">暂无操作记录</td></tr>';
        }
        html += '</tbody></table></div>';

        document.getElementById('pageContent').innerHTML = html;

        // 绘制趋势图
        if (d.search_trend && d.search_trend.length) {
            drawSimpleBar('searchTrendChart', d.search_trend);
        }
    }).catch(function (e) { document.getElementById('pageContent').innerHTML = '<div class="empty-state">加载失败</div>'; });
}

function statCard(label, value, colorClass, sub) {
    return '<div class="stat-card"><div class="stat-label">' + label + '</div>' +
        '<div class="stat-value ' + (colorClass || '') + '">' + value + '</div>' +
        '<div class="stat-sub">' + (sub || '') + '</div></div>';
}
function ds_total_text(d) { return d.ds_total; }

function drawSimpleBar(id, data) {
    var el = document.getElementById(id);
    if (!el) return;
    var maxVal = Math.max.apply(null, data.map(function (d) { return d.count; }));
    if (maxVal === 0) maxVal = 1;
    var barW = el.offsetWidth / data.length - 20;
    var h = 200;
    var html = '<svg width="100%" height="' + h + '" style="overflow:visible;">';
    data.forEach(function (d, i) {
        var barH = (d.count / maxVal) * (h - 40);
        var x = i * (el.offsetWidth / data.length) + 10;
        var y = h - barH - 20;
        html += '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + barH + '" fill="#1677ff" rx="4"/>';
        html += '<text x="' + (x + barW / 2) + '" y="' + (y - 5) + '" text-anchor="middle" font-size="12" fill="#666">' + d.count + '</text>';
        html += '<text x="' + (x + barW / 2) + '" y="' + (h - 5) + '" text-anchor="middle" font-size="11" fill="#999">' + d.date + '</text>';
    });
    html += '</svg>';
    el.innerHTML = html;
}

// ========== 2. 网站用户管理 ==========
function renderSiteUsers(page) {
    currentPage = page;
    var keyword = document.getElementById('searchInput') ? document.getElementById('searchInput').value.trim() : '';
    var url = '/site-users?page=' + page + '&size=20' + (keyword ? '&keyword=' + encodeURIComponent(keyword) : '');
    api(url).then(function (res) {
        if (!res.success) return;
        var html = '<div class="search-bar"><input type="text" id="searchInput" placeholder="搜索用户名" value="' + escapeHtml(keyword) + '"><button class="btn-primary" onclick="renderSiteUsers(1)">搜索</button></div>';
        html += '<div class="card"><table class="data-table"><thead><tr><th>用户名</th><th>自选数</th><th>持仓数</th><th>注册时间</th><th>状态</th><th>操作</th></tr></thead><tbody>';
        res.list.forEach(function (u) {
            html += '<tr><td><strong>' + escapeHtml(u.username) + '</strong></td><td>' + u.favorites_count + '</td><td>' + u.holdings_count + '</td><td>' + escapeHtml(u.create_time_str) + '</td>';
            html += '<td>' + (u.recreated ? '<span class="tag tag-warning">需重建</span>' : '<span class="tag tag-success">正常</span>') + '</td>';
            html += '<td><div class="btn-group"><button class="btn-default btn-sm" onclick="viewSiteUser(\'' + escapeHtml(u.username) + '\')">详情</button>';
            html += '<button class="btn-default btn-sm" onclick="resetSiteUserPw(\'' + escapeHtml(u.username) + '\')">重置密码</button>';
            html += '<button class="btn-danger btn-sm" onclick="deleteSiteUser(\'' + escapeHtml(u.username) + '\')">删除</button></div></td></tr>';
        });
        if (!res.list.length) html += '<tr><td colspan="6" class="text-center" style="color:#999;padding:20px;">暂无用户</td></tr>';
        html += '</tbody></table>';
        html += renderPagination(res.total, page, 20, 'renderSiteUsers');
        html += '</div>';
        document.getElementById('pageContent').innerHTML = html;
    });
}

function viewSiteUser(username) {
    api('/site-users/' + encodeURIComponent(username)).then(function (res) {
        if (!res.success) { showToast(res.message, 'error'); return; }
        var u = res.user;
        var html = '<div class="form-group"><label>用户名</label><input type="text" value="' + escapeHtml(username) + '" readonly></div>';
        html += '<div class="form-group"><label>注册时间</label><input type="text" value="' + escapeHtml(u.create_time_str) + '" readonly></div>';
        html += '<div class="form-group"><label>自选基金 (' + (u.favorites ? u.favorites.length : 0) + ')</label>';
        html += '<textarea rows="6" readonly>' + escapeHtml(JSON.stringify(u.favorites, null, 2)) + '</textarea></div>';
        html += '<div class="form-group"><label>持仓记录 (' + (u.holdings ? u.holdings.length : 0) + ')</label>';
        html += '<textarea rows="6" readonly>' + escapeHtml(JSON.stringify(u.holdings, null, 2)) + '</textarea></div>';
        openModal('用户详情 - ' + username, html);
    });
}

function resetSiteUserPw(username) {
    var html = '<div class="form-group"><label>新密码</label><input type="text" id="newPwInput" placeholder="输入新密码（至少6位）"></div>';
    html += '<div style="color:#999;font-size:12px;">重置后密码将直接生效，用户需用新密码登录</div>';
    openModal('重置密码 - ' + username, html, '<button class="btn-default" onclick="closeModal()">取消</button><button class="btn-primary" onclick="doResetSiteUserPw(\'' + escapeHtml(username) + '\')">确认重置</button>');
}

function doResetSiteUserPw(username) {
    var pw = document.getElementById('newPwInput').value.trim();
    if (pw.length < 6) { showToast('密码至少6位', 'error'); return; }
    api('/site-users/' + encodeURIComponent(username) + '/reset-password', 'POST', { password: pw }).then(function (res) {
        if (res.success) { showToast(res.message, 'success'); closeModal(); }
        else showToast(res.message, 'error');
    });
}

function deleteSiteUser(username) {
    if (!confirm('确定删除用户 "' + username + '"？此操作不可恢复！')) return;
    api('/site-users/' + encodeURIComponent(username), 'DELETE').then(function (res) {
        showToast(res.success ? '已删除' : res.message, res.success ? 'success' : 'error');
        if (res.success) renderSiteUsers(currentPage);
    });
}

// ========== 3. 管理员管理 ==========
function renderAdmins(page) {
    currentPage = page;
    api('/admins?page=' + page + '&size=20').then(function (res) {
        if (!res.success) return;
        var html = '<div class="search-bar"><button class="btn-primary" onclick="showCreateAdmin()">+ 新增管理员</button></div>';
        html += '<div class="card"><table class="data-table"><thead><tr><th>ID</th><th>用户名</th><th>角色</th><th>状态</th><th>邮箱</th><th>最后登录</th><th>操作</th></tr></thead><tbody>';
        res.list.forEach(function (a) {
            html += '<tr><td>' + a.id + '</td><td><strong>' + escapeHtml(a.username) + '</strong></td>';
            html += '<td><span class="tag ' + (a.role === 'superadmin' ? 'tag-primary' : a.role === 'operator' ? 'tag-success' : 'tag-default') + '">' + escapeHtml(a.role_name) + '</span></td>';
            html += '<td>' + (a.status === 1 ? '<span class="tag tag-success">正常</span>' : '<span class="tag tag-error">禁用</span>') + '</td>';
            html += '<td>' + escapeHtml(a.email || '-') + '</td><td>' + escapeHtml(a.last_login_str) + '</td>';
            html += '<td><div class="btn-group"><button class="btn-default btn-sm" onclick="editAdmin(' + a.id + ')">编辑</button>';
            html += '<button class="btn-default btn-sm" onclick="resetAdminPw(' + a.id + ',\'' + escapeHtml(a.username) + '\')">重置密码</button>';
            if (a.username !== adminInfo.username) {
                html += '<button class="btn-danger btn-sm" onclick="deleteAdmin(' + a.id + ',\'' + escapeHtml(a.username) + '\')">删除</button>';
            }
            html += '</div></td></tr>';
        });
        if (!res.list.length) html += '<tr><td colspan="7" class="text-center" style="color:#999;padding:20px;">暂无管理员</td></tr>';
        html += '</tbody></table>';
        html += renderPagination(res.total, page, 20, 'renderAdmins');
        html += '</div>';
        document.getElementById('pageContent').innerHTML = html;
    });
}

function showCreateAdmin() {
    var html = '<div class="form-group"><label>用户名</label><input type="text" id="caUsername" placeholder="3-20位字符"></div>';
    html += '<div class="form-group"><label>密码</label><input type="password" id="caPassword" placeholder="至少6位"></div>';
    html += '<div class="form-group"><label>角色</label><select id="caRole"><option value="readonly">只读运维</option><option value="operator">运营管理员</option><option value="superadmin">超级管理员</option></select></div>';
    html += '<div class="form-group"><label>邮箱（选填）</label><input type="email" id="caEmail"></div>';
    openModal('新增管理员', html, '<button class="btn-default" onclick="closeModal()">取消</button><button class="btn-primary" onclick="doCreateAdmin()">创建</button>');
}

function doCreateAdmin() {
    var data = {
        username: document.getElementById('caUsername').value.trim(),
        password: document.getElementById('caPassword').value,
        role: document.getElementById('caRole').value,
        email: document.getElementById('caEmail').value.trim()
    };
    if (!data.username || !data.password) { showToast('用户名和密码不能为空', 'error'); return; }
    api('/admins', 'POST', data).then(function (res) {
        if (res.success) { showToast('创建成功', 'success'); closeModal(); renderAdmins(1); }
        else showToast(res.message, 'error');
    });
}

function editAdmin(id) {
    api('/roles').then(function (res) {
        if (!res.success) return;
        var options = res.list.map(function (r) { return '<option value="' + r.code + '">' + r.name + '</option>'; }).join('');
        var html = '<div class="form-group"><label>角色</label><select id="eaRole">' + options + '</select></div>';
        html += '<div class="form-group"><label>状态</label><select id="eaStatus"><option value="1">正常</option><option value="0">禁用</option></select></div>';
        html += '<div class="form-group"><label>邮箱</label><input type="email" id="eaEmail"></div>';
        openModal('编辑管理员 #' + id, html, '<button class="btn-default" onclick="closeModal()">取消</button><button class="btn-primary" onclick="doEditAdmin(' + id + ')">保存</button>');
    });
}

function doEditAdmin(id) {
    var data = {
        role: document.getElementById('eaRole').value,
        status: parseInt(document.getElementById('eaStatus').value),
        email: document.getElementById('eaEmail').value.trim()
    };
    api('/admins/' + id, 'PUT', data).then(function (res) {
        if (res.success) { showToast('已更新', 'success'); closeModal(); renderAdmins(currentPage); }
        else showToast(res.message, 'error');
    });
}

function resetAdminPw(id, username) {
    var html = '<div class="form-group"><label>新密码</label><input type="text" id="adminNewPw" placeholder="输入新密码（至少6位）"></div>';
    openModal('重置密码 - ' + username, html, '<button class="btn-default" onclick="closeModal()">取消</button><button class="btn-primary" onclick="doResetAdminPw(' + id + ')">确认重置</button>');
}

function doResetAdminPw(id) {
    var pw = document.getElementById('adminNewPw').value.trim();
    if (pw.length < 6) { showToast('密码至少6位', 'error'); return; }
    api('/admins/' + id + '/reset-password', 'POST', { password: pw }).then(function (res) {
        if (res.success) { showToast('密码已重置', 'success'); closeModal(); }
        else showToast(res.message, 'error');
    });
}

function deleteAdmin(id, username) {
    if (!confirm('确定删除管理员 "' + username + '"？')) return;
    api('/admins/' + id, 'DELETE').then(function (res) {
        showToast(res.success ? '已删除' : res.message, res.success ? 'success' : 'error');
        if (res.success) renderAdmins(currentPage);
    });
}

// ========== 4. 基金数据管理 ==========
function renderFunds(page) {
    currentPage = page;
    var keyword = document.getElementById('fundSearchInput') ? document.getElementById('fundSearchInput').value.trim() : '';
    var status = document.getElementById('fundStatusFilter') ? document.getElementById('fundStatusFilter').value : '';
    var url = '/funds?page=' + page + '&size=20' + (keyword ? '&keyword=' + encodeURIComponent(keyword) : '') + (status ? '&status=' + status : '');
    api(url).then(function (res) {
        if (!res.success) return;
        var html = '<div class="search-bar">';
        html += '<input type="text" id="fundSearchInput" placeholder="基金代码/名称" value="' + escapeHtml(keyword) + '">';
        html += '<select id="fundStatusFilter"><option value="">全部状态</option><option value="normal">正常</option><option value="presale">预售</option><option value="liquidated">已清盘</option><option value="suspended">暂停交易</option></select>';
        html += '<button class="btn-primary" onclick="renderFunds(1)">搜索</button>';
        html += '<button class="btn-default" onclick="showRefreshFund()">手动刷新净值</button>';
        html += '</div>';
        html += '<div class="card"><table class="data-table"><thead><tr><th>代码</th><th>名称</th><th>类型</th><th>基金公司</th><th>经理</th><th>净值</th><th>涨跌幅</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>';
        res.list.forEach(function (f) {
            var changeClass = f.change > 0 ? 'tag-error' : (f.change < 0 ? 'tag-success' : 'tag-default');
            html += '<tr><td>' + escapeHtml(f.code) + '</td><td>' + escapeHtml(f.name) + '</td><td>' + escapeHtml(f.type || '-') + '</td><td>' + escapeHtml(f.company || '-') + '</td><td>' + escapeHtml(f.manager || '-') + '</td>';
            html += '<td class="text-right">' + (f.net_value || '0.0000') + '</td><td><span class="tag ' + changeClass + '">' + (f.change > 0 ? '+' : '') + f.change + '%</span></td>';
            html += '<td><span class="tag ' + (f.status === 'normal' ? 'tag-success' : 'tag-warning') + '">' + escapeHtml(f.status) + '</span></td>';
            html += '<td>' + escapeHtml(f.update_time_str) + '</td>';
            html += '<td><button class="btn-default btn-sm" onclick="refreshFund(\'' + escapeHtml(f.code) + '\')">刷新</button></td></tr>';
        });
        if (!res.list.length) html += '<tr><td colspan="10" class="text-center" style="color:#999;padding:20px;">暂无缓存数据，请先执行采集任务</td></tr>';
        html += '</tbody></table>';
        html += renderPagination(res.total, page, 20, 'renderFunds');
        html += '</div>';
        document.getElementById('pageContent').innerHTML = html;
        if (document.getElementById('fundStatusFilter')) document.getElementById('fundStatusFilter').value = status;
    });
}

function showRefreshFund() {
    var html = '<div class="form-group"><label>基金代码</label><input type="text" id="refreshFundCode" placeholder="如 000001"></div>';
    openModal('手动刷新基金净值', html, '<button class="btn-default" onclick="closeModal()">取消</button><button class="btn-primary" onclick="doRefreshFund()">刷新</button>');
}

function doRefreshFund() {
    var code = document.getElementById('refreshFundCode').value.trim();
    if (!code) { showToast('请输入基金代码', 'error'); return; }
    api('/funds/refresh', 'POST', { code: code }).then(function (res) {
        if (res.success) { showToast(res.message, 'success'); closeModal(); renderFunds(1); }
        else showToast(res.message, 'error');
    });
}

function refreshFund(code) {
    api('/funds/refresh', 'POST', { code: code }).then(function (res) {
        showToast(res.success ? res.message : res.message, res.success ? 'success' : 'error');
        if (res.success) renderFunds(currentPage);
    });
}

// ========== 5. 净值数据监控 ==========
function renderNavMonitor() {
    api('/nav/monitor').then(function (res) {
        if (!res.success) return;
        var d = res.data;
        var html = '<div class="stat-grid">';
        html += statCard('检测基金数', d.total_checked, '', '缓存基金总数');
        html += statCard('异常数', d.anomaly_count, d.anomaly_count > 0 ? 'danger' : 'success', '需要关注');
        html += statCard('偏差阈值', d.threshold + '%', 'warning', '涨幅超过此值告警');
        html += '</div>';

        html += '<div class="card"><div class="card-title">异常数据列表</div>';
        if (d.anomalies.length === 0) {
            html += '<div class="empty-state"><div class="icon">✅</div><p>暂无异常数据，一切正常</p></div>';
        } else {
            html += '<table class="data-table"><thead><tr><th>代码</th><th>名称</th><th>净值</th><th>涨跌幅</th><th>问题</th><th>更新时间</th></tr></thead><tbody>';
            d.anomalies.forEach(function (f) {
                html += '<tr><td>' + escapeHtml(f.code) + '</td><td>' + escapeHtml(f.name) + '</td><td class="text-right">' + (f.net_value || '0') + '</td><td>' + f.change + '%</td>';
                html += '<td>' + f.issues.map(function (i) { return '<span class="tag tag-error">' + i + '</span>'; }).join(' ') + '</td>';
                html += '<td>' + escapeHtml(f.update_time_str) + '</td></tr>';
            });
            html += '</tbody></table>';
        }
        html += '</div>';
        document.getElementById('pageContent').innerHTML = html;
    });
}

// ========== 6. 自选数据统计 ==========
function renderFavoritesStats() {
    api('/favorites/stats').then(function (res) {
        if (!res.success) return;
        var d = res.data;
        var html = '<div class="stat-grid">';
        html += statCard('自选用户数', d.total_users, 'primary', '有自选的用户');
        html += statCard('自选总数', d.total_favorites, '', '所有自选记录');
        html += statCard('被自选基金数', d.unique_funds, '', '不同基金数量');
        html += '</div>';

        html += '<div class="card"><div class="card-title">热门基金排行（被自选最多 Top 50）</div>';
        if (d.hot_funds.length === 0) {
            html += '<div class="empty-state"><div class="icon">📊</div><p>暂无自选数据</p></div>';
        } else {
            html += '<table class="data-table"><thead><tr><th>排名</th><th>基金代码</th><th>被自选次数</th></tr></thead><tbody>';
            d.hot_funds.forEach(function (f, i) {
                html += '<tr><td>' + (i + 1) + '</td><td><strong>' + escapeHtml(f.code) + '</strong></td><td>' + f.count + '</td></tr>';
            });
            html += '</tbody></table>';
        }
        html += '</div>';
        document.getElementById('pageContent').innerHTML = html;
    });
}

// ========== 7. 搜索行为统计 ==========
function renderSearchStats() {
    api('/search/stats?days=7').then(function (res) {
        if (!res.success) return;
        var d = res.data;
        var html = '<div class="stat-grid">';
        html += statCard('7天搜索总量', d.total, 'primary', '最近7天');
        html += statCard('今日搜索', d.today, '', '今天0点至今');
        html += statCard('无效搜索', d.invalid, d.invalid > 0 ? 'warning' : 'success', '无结果搜索');
        html += '</div>';

        html += '<div class="card"><div class="card-title">热搜词排行 Top 20</div>';
        if (d.hot_keywords.length === 0) {
            html += '<div class="empty-state"><div class="icon">🔍</div><p>暂无搜索数据</p></div>';
        } else {
            html += '<table class="data-table"><thead><tr><th>排名</th><th>搜索词</th><th>搜索次数</th><th>占比</th></tr></thead><tbody>';
            d.hot_keywords.forEach(function (k, i) {
                var pct = d.total > 0 ? (k.count / d.total * 100).toFixed(1) : '0';
                html += '<tr><td>' + (i + 1) + '</td><td><strong>' + escapeHtml(k.keyword) + '</strong></td><td>' + k.count + '</td><td>' + pct + '%</td></tr>';
            });
            html += '</tbody></table>';
        }
        html += '</div>';

        html += '<div class="card"><div class="card-title">搜索日志</div><div id="searchLogList"><div class="loading-state">加载中...</div></div></div>';
        document.getElementById('pageContent').innerHTML = html;
        loadSearchLogs(1);
    });
}

function loadSearchLogs(page) {
    api('/search/logs?page=' + page + '&size=15').then(function (res) {
        if (!res.success) return;
        var el = document.getElementById('searchLogList');
        if (!el) return;
        var html = '<table class="data-table"><thead><tr><th>时间</th><th>搜索词</th><th>结果数</th><th>IP</th></tr></thead><tbody>';
        res.list.forEach(function (l) {
            html += '<tr><td>' + escapeHtml(l.time_str) + '</td><td>' + escapeHtml(l.keyword) + '</td><td>' + (l.result_count > 0 ? '<span class="tag tag-success">' + l.result_count + '</span>' : '<span class="tag tag-error">0</span>') + '</td><td>' + escapeHtml(l.ip || '-') + '</td></tr>';
        });
        if (!res.list.length) html += '<tr><td colspan="4" class="text-center" style="color:#999;padding:20px;">暂无日志</td></tr>';
        html += '</tbody></table>';
        html += renderPagination(res.total, page, 15, 'loadSearchLogs');
        el.innerHTML = html;
    });
}

// ========== 8. 采集任务管理 ==========
function renderTasks() {
    api('/tasks').then(function (res) {
        if (!res.success) return;
        var html = '<div class="card"><div class="card-title">采集任务列表</div>';
        html += '<table class="data-table"><thead><tr><th>任务名称</th><th>类型</th><th>描述</th><th>Cron表达式</th><th>状态</th><th>最后运行</th><th>结果</th><th>操作</th></tr></thead><tbody>';
        res.list.forEach(function (t) {
            html += '<tr><td><strong>' + escapeHtml(t.name) + '</strong></td><td>' + escapeHtml(t.type) + '</td><td>' + escapeHtml(t.description) + '</td><td><code>' + escapeHtml(t.cron || '-') + '</code></td>';
            html += '<td><label class="switch"><input type="checkbox" ' + (t.status === 1 ? 'checked' : '') + ' onchange="toggleTask(' + t.id + ', this.checked)"><span class="slider"></span></label></td>';
            html += '<td>' + escapeHtml(t.last_run_str) + '</td>';
            var statusTag = t.last_run_status === 'success' ? '<span class="tag tag-success">成功</span>' : t.last_run_status === 'fail' ? '<span class="tag tag-error">失败</span>' : '<span class="tag tag-default">未运行</span>';
            html += '<td>' + statusTag + ' ' + (t.last_records || 0) + '条 ' + (t.last_run_duration ? t.last_run_duration.toFixed(1) + 's' : '') + '</td>';
            html += '<td><div class="btn-group"><button class="btn-primary btn-sm" onclick="runTask(' + t.id + ')">运行</button>';
            html += '<button class="btn-default btn-sm" onclick="editTask(' + t.id + ')">配置</button>';
            html += '<button class="btn-default btn-sm" onclick="viewTaskLogs(' + t.id + ')">日志</button></div></td></tr>';
        });
        html += '</tbody></table></div>';
        document.getElementById('pageContent').innerHTML = html;
    });
}

function toggleTask(id, enabled) {
    api('/tasks/' + id + '/toggle', 'POST', { enabled: enabled }).then(function (res) {
        showToast(res.success ? res.message : res.message, res.success ? 'success' : 'error');
    });
}

function runTask(id) {
    if (!confirm('确定手动触发此任务？')) return;
    showToast('任务执行中...', 'info');
    api('/tasks/' + id + '/run', 'POST').then(function (res) {
        showToast(res.success ? res.message + ' (' + (res.records || 0) + '条)' : res.message, res.success ? 'success' : 'error');
        if (res.success) setTimeout(function () { renderTasks(); }, 1000);
    });
}

function editTask(id) {
    api('/tasks').then(function (res) {
        if (!res.success) return;
        var t = res.list.find(function (x) { return x.id === id; });
        if (!t) return;
        var html = '<div class="form-group"><label>任务名称</label><input type="text" id="etName" value="' + escapeHtml(t.name) + '"></div>';
        html += '<div class="form-group"><label>描述</label><input type="text" id="etDesc" value="' + escapeHtml(t.description) + '"></div>';
        html += '<div class="form-group"><label>Cron表达式</label><input type="text" id="etCron" value="' + escapeHtml(t.cron) + '" placeholder="如: 0 2 * * *"></div>';
        html += '<div style="color:#999;font-size:12px;margin-top:8px;">Cron格式: 分 时 日 月 周 (如 0 2 * * * = 每天2点)</div>';
        openModal('配置任务 - ' + t.name, html, '<button class="btn-default" onclick="closeModal()">取消</button><button class="btn-primary" onclick="doEditTask(' + id + ')">保存</button>');
    });
}

function doEditTask(id) {
    var data = {
        name: document.getElementById('etName').value.trim(),
        description: document.getElementById('etDesc').value.trim(),
        cron: document.getElementById('etCron').value.trim()
    };
    api('/tasks/' + id, 'PUT', data).then(function (res) {
        if (res.success) { showToast('已保存', 'success'); closeModal(); renderTasks(); }
        else showToast(res.message, 'error');
    });
}

function viewTaskLogs(id) {
    api('/tasks/' + id + '/logs?page=1&size=20').then(function (res) {
        if (!res.success) return;
        var html = '<table class="data-table"><thead><tr><th>时间</th><th>状态</th><th>记录数</th><th>耗时</th><th>详情</th></tr></thead><tbody>';
        res.list.forEach(function (l) {
            var tag = l.status === 'success' ? 'tag-success' : 'tag-error';
            html += '<tr><td>' + escapeHtml(l.start_str) + '</td><td><span class="tag ' + tag + '">' + l.status + '</span></td><td>' + l.records + '</td><td>' + escapeHtml(l.duration_str) + '</td><td>' + escapeHtml(l.detail || l.error || '-') + '</td></tr>';
        });
        if (!res.list.length) html += '<tr><td colspan="5" class="text-center" style="color:#999;padding:20px;">暂无日志</td></tr>';
        html += '</tbody></table>';
        openModal('任务执行日志', html);
    });
}

// ========== 9. 数据源管理 ==========
function renderDataSources() {
    api('/data-sources').then(function (res) {
        if (!res.success) return;
        var html = '<div class="search-bar"><button class="btn-primary" onclick="showAddSource()">+ 新增数据源</button></div>';
        html += '<div class="card"><table class="data-table"><thead><tr><th>名称</th><th>类型</th><th>URL</th><th>优先级</th><th>超时(s)</th><th>状态</th><th>操作</th></tr></thead><tbody>';
        res.list.forEach(function (s) {
            html += '<tr><td><strong>' + escapeHtml(s.name) + '</strong></td><td>' + escapeHtml(s.type) + '</td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(s.url) + '</td><td>' + s.priority + '</td><td>' + s.timeout + '</td>';
            html += '<td>' + (s.status === 1 ? '<span class="tag tag-success">启用</span>' : '<span class="tag tag-default">禁用</span>') + '</td>';
            html += '<td><div class="btn-group"><button class="btn-default btn-sm" onclick="testSource(' + s.id + ')">测试</button>';
            html += '<button class="btn-default btn-sm" onclick="editSource(' + s.id + ')">编辑</button>';
            html += '<button class="btn-danger btn-sm" onclick="deleteSource(' + s.id + ')">删除</button></div></td></tr>';
        });
        if (!res.list.length) html += '<tr><td colspan="7" class="text-center" style="color:#999;padding:20px;">暂无数据源</td></tr>';
        html += '</tbody></table></div>';
        document.getElementById('pageContent').innerHTML = html;
    });
}

function showAddSource() {
    var html = '<div class="form-group"><label>名称</label><input type="text" id="dsName"></div>';
    html += '<div class="form-row"><div class="form-group"><label>类型</label><select id="dsType"><option value="search">搜索</option><option value="estimate">估值</option><option value="history">历史净值</option><option value="detail">详情</option><option value="ranking">排行</option><option value="news">资讯</option><option value="indices">指数</option><option value="sectors">板块</option></select></div>';
    html += '<div class="form-group"><label>优先级</label><input type="number" id="dsPriority" value="1"></div></div>';
    html += '<div class="form-group"><label>URL（{code}为占位符）</label><input type="text" id="dsUrl"></div>';
    html += '<div class="form-row"><div class="form-group"><label>超时(秒)</label><input type="number" id="dsTimeout" value="10"></div>';
    html += '<div class="form-group"><label>间隔(秒)</label><input type="number" id="dsInterval" value="0"></div></div>';
    html += '<div class="form-group"><label>备注</label><input type="text" id="dsRemark"></div>';
    openModal('新增数据源', html, '<button class="btn-default" onclick="closeModal()">取消</button><button class="btn-primary" onclick="doAddSource()">添加</button>');
}

function doAddSource() {
    var data = {
        name: document.getElementById('dsName').value.trim(),
        type: document.getElementById('dsType').value,
        url: document.getElementById('dsUrl').value.trim(),
        priority: parseInt(document.getElementById('dsPriority').value) || 1,
        timeout: parseInt(document.getElementById('dsTimeout').value) || 10,
        interval: parseInt(document.getElementById('dsInterval').value) || 0,
        remark: document.getElementById('dsRemark').value.trim()
    };
    if (!data.name || !data.url) { showToast('名称和URL不能为空', 'error'); return; }
    api('/data-sources', 'POST', data).then(function (res) {
        if (res.success) { showToast('已添加', 'success'); closeModal(); renderDataSources(); }
        else showToast(res.message, 'error');
    });
}

function editSource(id) {
    api('/data-sources').then(function (res) {
        if (!res.success) return;
        var s = res.list.find(function (x) { return x.id === id; });
        if (!s) return;
        var html = '<div class="form-group"><label>名称</label><input type="text" id="esName" value="' + escapeHtml(s.name) + '"></div>';
        html += '<div class="form-row"><div class="form-group"><label>优先级</label><input type="number" id="esPriority" value="' + s.priority + '"></div>';
        html += '<div class="form-group"><label>超时(秒)</label><input type="number" id="esTimeout" value="' + s.timeout + '"></div></div>';
        html += '<div class="form-group"><label>备注</label><input type="text" id="esRemark" value="' + escapeHtml(s.remark) + '"></div>';
        html += '<div class="form-group"><label>状态</label><select id="esStatus"><option value="1" ' + (s.status === 1 ? 'selected' : '') + '>启用</option><option value="0" ' + (s.status === 0 ? 'selected' : '') + '>禁用</option></select></div>';
        openModal('编辑数据源', html, '<button class="btn-default" onclick="closeModal()">取消</button><button class="btn-primary" onclick="doEditSource(' + id + ')">保存</button>');
    });
}

function doEditSource(id) {
    var data = {
        name: document.getElementById('esName').value.trim(),
        priority: parseInt(document.getElementById('esPriority').value) || 1,
        timeout: parseInt(document.getElementById('esTimeout').value) || 10,
        remark: document.getElementById('esRemark').value.trim(),
        status: parseInt(document.getElementById('esStatus').value)
    };
    api('/data-sources/' + id, 'PUT', data).then(function (res) {
        if (res.success) { showToast('已保存', 'success'); closeModal(); renderDataSources(); }
        else showToast(res.message, 'error');
    });
}

function deleteSource(id) {
    if (!confirm('确定删除此数据源？')) return;
    api('/data-sources/' + id, 'DELETE').then(function (res) {
        showToast(res.success ? '已删除' : res.message, res.success ? 'success' : 'error');
        if (res.success) renderDataSources();
    });
}

function testSource(id) {
    showToast('测试中...', 'info');
    api('/data-sources/' + id + '/test', 'POST').then(function (res) {
        if (res.success && res.data) {
            var d = res.data;
            var msg = d.reachable ? '连通正常' : '连接失败';
            showToast(msg + (d.response_time ? ' (' + d.response_time + ')' : ''), d.reachable ? 'success' : 'error');
        } else {
            showToast('测试失败', 'error');
        }
    });
}

// ========== 10. 缓存与性能监控 ==========
function renderCacheStatus() {
    api('/cache/status').then(function (res) {
        if (!res.success) return;
        var d = res.data;
        var html = '<div class="stat-grid">';
        html += statCard('数据库大小', d.db_size, '', d.db_path);
        html += statCard('板块缓存数', d.sector_cache ? d.sector_cache.length : 0, '', '内存缓存');
        html += statCard('验证码待发', d.email_code_pending, '', '待发送邮件');
        html += '</div>';

        html += '<div class="card"><div class="card-title">板块缓存详情</div>';
        if (d.sector_cache && d.sector_cache.length) {
            html += '<table class="data-table"><thead><tr><th>缓存键</th><th>缓存时长</th><th>数据条数</th></tr></thead><tbody>';
            d.sector_cache.forEach(function (c) {
                html += '<tr><td>' + escapeHtml(c.key) + '</td><td>' + escapeHtml(c.age) + '</td><td>' + c.items + '</td></tr>';
            });
            html += '</tbody></table>';
            html += '<div style="margin-top:16px;"><button class="btn-danger" onclick="clearSectorCache()">清除板块缓存</button></div>';
        } else {
            html += '<div class="empty-state"><div class="icon">📦</div><p>暂无板块缓存</p></div>';
        }
        html += '</div>';
        document.getElementById('pageContent').innerHTML = html;
    });
}

function clearSectorCache() {
    if (!confirm('确定清除所有板块缓存？')) return;
    api('/cache/sector/clear', 'POST').then(function (res) {
        showToast(res.success ? '缓存已清除' : res.message, res.success ? 'success' : 'error');
        if (res.success) renderCacheStatus();
    });
}

// ========== 11. 系统配置 ==========
function renderConfig() {
    api('/config').then(function (res) {
        if (!res.success) return;
        var d = res.data;
        var html = '<div class="card"><div class="card-title">系统配置</div>';
        html += '<div id="configForm">';
        Object.keys(d).forEach(function (key) {
            html += '<div class="form-group"><label>' + escapeHtml(key) + ' <span style="color:#999;font-weight:normal;">(' + escapeHtml(d[key].description || '') + ')</span></label>';
            html += '<input type="text" id="cfg_' + key + '" value="' + escapeHtml(d[key].value) + '"></div>';
        });
        html += '</div>';
        html += '<div style="margin-top:16px;"><button class="btn-primary" onclick="saveConfig()">保存配置</button></div>';
        html += '</div>';
        document.getElementById('pageContent').innerHTML = html;
    });
}

function saveConfig() {
    var inputs = document.querySelectorAll('[id^="cfg_"]');
    var configs = {};
    inputs.forEach(function (input) {
        var key = input.id.replace('cfg_', '');
        configs[key] = input.value;
    });
    api('/config', 'POST', { configs: configs }).then(function (res) {
        showToast(res.success ? '配置已保存' : res.message, res.success ? 'success' : 'error');
    });
}

// ========== 12. 日志管理 ==========
function renderLogs() {
    var html = '<div class="card"><div class="card-title">登录日志</div><div id="loginLogList"><div class="loading-state">加载中...</div></div></div>';
    html += '<div class="card"><div class="card-title">操作日志</div><div id="opLogList"><div class="loading-state">加载中...</div></div></div>';
    document.getElementById('pageContent').innerHTML = html;
    loadLoginLogs(1);
    loadOpLogs(1);
}

function loadLoginLogs(page) {
    api('/logs/login?page=' + page + '&size=15').then(function (res) {
        if (!res.success) return;
        var el = document.getElementById('loginLogList');
        if (!el) return;
        var html = '<table class="data-table"><thead><tr><th>时间</th><th>用户名</th><th>状态</th><th>IP</th><th>消息</th></tr></thead><tbody>';
        res.list.forEach(function (l) {
            var tag = l.status === 'success' ? 'tag-success' : 'tag-error';
            html += '<tr><td>' + escapeHtml(l.time_str) + '</td><td>' + escapeHtml(l.username) + '</td><td><span class="tag ' + tag + '">' + l.status + '</span></td><td>' + escapeHtml(l.ip) + '</td><td>' + escapeHtml(l.message) + '</td></tr>';
        });
        if (!res.list.length) html += '<tr><td colspan="5" class="text-center" style="color:#999;padding:20px;">暂无日志</td></tr>';
        html += '</tbody></table>';
        html += renderPagination(res.total, page, 15, 'loadLoginLogs');
        el.innerHTML = html;
    });
}

function loadOpLogs(page) {
    api('/logs/operation?page=' + page + '&size=15').then(function (res) {
        if (!res.success) return;
        var el = document.getElementById('opLogList');
        if (!el) return;
        var html = '<table class="data-table"><thead><tr><th>时间</th><th>管理员</th><th>模块</th><th>操作</th><th>详情</th></tr></thead><tbody>';
        res.list.forEach(function (l) {
            html += '<tr><td>' + escapeHtml(l.time_str) + '</td><td>' + escapeHtml(l.username) + '</td><td>' + escapeHtml(l.module) + '</td><td>' + escapeHtml(l.action) + '</td><td>' + escapeHtml(l.detail) + '</td></tr>';
        });
        if (!res.list.length) html += '<tr><td colspan="5" class="text-center" style="color:#999;padding:20px;">暂无日志</td></tr>';
        html += '</tbody></table>';
        html += renderPagination(res.total, page, 15, 'loadOpLogs');
        el.innerHTML = html;
    });
}

// ========== 修改密码 ==========
function savePassword() {
    var oldPw = document.getElementById('cpOldPassword').value;
    var newPw = document.getElementById('cpNewPassword').value;
    var confirmPw = document.getElementById('cpConfirmPassword').value;
    if (!oldPw || !newPw) { showToast('请填写完整', 'error'); return; }
    if (newPw !== confirmPw) { showToast('两次密码不一致', 'error'); return; }
    if (newPw.length < 6) { showToast('新密码至少6位', 'error'); return; }
    api('/auth/change-password', 'POST', { oldPassword: oldPw, newPassword: newPw }).then(function (res) {
        if (res.success) {
            showToast('密码修改成功', 'success');
            document.getElementById('changePwModal').style.display = 'none';
            document.getElementById('cpOldPassword').value = '';
            document.getElementById('cpNewPassword').value = '';
            document.getElementById('cpConfirmPassword').value = '';
        } else {
            showToast(res.message, 'error');
        }
    });
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', function () {
    // 登录按钮
    document.getElementById('btnLogin').addEventListener('click', login);
    document.getElementById('loginPassword').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') login();
    });
    // 退出
    document.getElementById('btnLogout').addEventListener('click', function () {
        if (confirm('确定退出登录？')) logout();
    });
    // 修改密码
    document.getElementById('btnChangePw').addEventListener('click', function () {
        document.getElementById('changePwModal').style.display = 'flex';
    });
    document.getElementById('btnSavePw').addEventListener('click', savePassword);
    // 菜单切换（移动端）
    document.getElementById('menuToggle').addEventListener('click', function () {
        document.getElementById('sidebar').classList.toggle('open');
    });

    // 验证令牌
    if (token) {
        verifyToken();
    } else {
        document.getElementById('loginPage').style.display = 'flex';
    }
});

// 暴露到全局
window.renderSiteUsers = renderSiteUsers;
window.renderAdmins = renderAdmins;
window.renderFunds = renderFunds;
window.viewSiteUser = viewSiteUser;
window.resetSiteUserPw = resetSiteUserPw;
window.doResetSiteUserPw = doResetSiteUserPw;
window.deleteSiteUser = deleteSiteUser;
window.showCreateAdmin = showCreateAdmin;
window.doCreateAdmin = doCreateAdmin;
window.editAdmin = editAdmin;
window.doEditAdmin = doEditAdmin;
window.resetAdminPw = resetAdminPw;
window.doResetAdminPw = doResetAdminPw;
window.deleteAdmin = deleteAdmin;
window.showRefreshFund = showRefreshFund;
window.doRefreshFund = doRefreshFund;
window.refreshFund = refreshFund;
window.renderNavMonitor = renderNavMonitor;
window.renderFavoritesStats = renderFavoritesStats;
window.renderSearchStats = renderSearchStats;
window.loadSearchLogs = loadSearchLogs;
window.renderTasks = renderTasks;
window.toggleTask = toggleTask;
window.runTask = runTask;
window.editTask = editTask;
window.doEditTask = doEditTask;
window.viewTaskLogs = viewTaskLogs;
window.renderDataSources = renderDataSources;
window.showAddSource = showAddSource;
window.doAddSource = doAddSource;
window.editSource = editSource;
window.doEditSource = doEditSource;
window.deleteSource = deleteSource;
window.testSource = testSource;
window.renderCacheStatus = renderCacheStatus;
window.clearSectorCache = clearSectorCache;
window.renderConfig = renderConfig;
window.saveConfig = saveConfig;
window.renderLogs = renderLogs;
window.loadLoginLogs = loadLoginLogs;
window.loadOpLogs = loadOpLogs;
window.navigate = navigate;
window.closeModal = closeModal;

})();
