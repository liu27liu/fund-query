#!/usr/bin/env python3
"""
后台管理API蓝图
包含：认证、角色权限、仪表盘、用户管理、基金管理、搜索统计、
      系统配置、数据源管理、采集任务、日志、缓存监控
"""
import os
import json
import time
import functools
from datetime import datetime
from flask import Blueprint, request, jsonify, g

import admin_db

admin_bp = Blueprint('admin', __name__, url_prefix='/admin/api')

# ========== 用户数据文件路径（与 server.py 共用）==========
_DB_DIR = '/data' if os.path.isdir('/data') else os.path.dirname(os.path.abspath(__file__))
_USERS_FILE = os.path.join(_DB_DIR, 'users.json')


def _load_site_users():
    """加载网站用户数据（读取 users.json）"""
    try:
        with open(_USERS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_site_users(users):
    """保存网站用户数据"""
    try:
        with open(_USERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(users, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f'[AdminAPI] 保存用户数据失败: {e}', flush=True)
        return False


# ========== 认证装饰器 ==========

def admin_required(perm=None):
    """管理员认证装饰器，可选权限检查"""
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            token = request.headers.get('Authorization', '').replace('Bearer ', '')
            admin = admin_db._verify_admin_token(token)
            if not admin:
                return jsonify({'success': False, 'message': '未登录或令牌已失效'}), 401
            g.admin = admin
            if perm and not admin_db._has_permission(admin, perm):
                return jsonify({'success': False, 'message': '权限不足'}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def _get_ip():
    return request.headers.get('X-Forwarded-For', '').split(',')[0].strip() or request.remote_addr or ''


def _log_op(module, action, detail=''):
    """记录操作日志"""
    if hasattr(g, 'admin'):
        admin_db.add_operation_log(g.admin['id'], g.admin['username'], module, action, detail, _get_ip())


def _fmt_time(ts):
    if not ts:
        return '-'
    return datetime.fromtimestamp(ts).strftime('%Y-%m-%d %H:%M:%S')


# ========== 1. 认证模块 ==========

@admin_bp.route('/auth/login', methods=['POST'])
def auth_login():
    """管理员登录"""
    data = request.json or {}
    username = (data.get('username', '') or '').strip()
    password = (data.get('password', '') or '').strip()
    if not username or not password:
        return jsonify({'success': False, 'message': '请输入用户名和密码'})

    admin, token = admin_db.verify_admin_login(username, password)
    ip = _get_ip()
    ua = request.headers.get('User-Agent', '')

    if admin is None:
        admin_db.add_login_log(0, username, ip, ua, 'fail', token)  # token here is error msg
        return jsonify({'success': False, 'message': token})

    admin_db.add_login_log(admin['id'], admin['username'], ip, ua, 'success')
    perms = admin_db._get_permissions(admin['role'])
    return jsonify({
        'success': True,
        'message': '登录成功',
        'token': token,
        'admin': {
            'id': admin['id'],
            'username': admin['username'],
            'role': admin['role'],
            'permissions': perms,
        }
    })


@admin_bp.route('/auth/verify', methods=['POST'])
def auth_verify():
    """验证令牌"""
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    admin = admin_db._verify_admin_token(token)
    if not admin:
        return jsonify({'success': False})
    perms = admin_db._get_permissions(admin['role'])
    return jsonify({
        'success': True,
        'admin': {
            'id': admin['id'],
            'username': admin['username'],
            'role': admin['role'],
            'permissions': perms,
        }
    })


@admin_bp.route('/auth/change-password', methods=['POST'])
@admin_required()
def auth_change_password():
    """修改自己的密码"""
    data = request.json or {}
    old_pw = data.get('oldPassword', '')
    new_pw = data.get('newPassword', '')
    if not old_pw or not new_pw:
        return jsonify({'success': False, 'message': '请输入原密码和新密码'})
    if len(new_pw) < 6:
        return jsonify({'success': False, 'message': '新密码至少6位'})
    ok, msg = admin_db.update_admin_password(g.admin['id'], old_pw, new_pw)
    if ok:
        _log_op('auth', '修改密码', g.admin['username'])
    return jsonify({'success': ok, 'message': msg})


# ========== 2. 管理员管理 ==========

@admin_bp.route('/admins', methods=['GET'])
@admin_required('admins')
def admin_list():
    """管理员列表"""
    page = int(request.args.get('page', 1))
    size = int(request.args.get('size', 20))
    admins, total = admin_db.list_admins(page, size)
    roles = {r['code']: r['name'] for r in admin_db.list_roles()}
    for a in admins:
        a['role_name'] = roles.get(a['role'], a['role'])
        a['create_time_str'] = _fmt_time(a.get('create_time'))
        a['last_login_str'] = _fmt_time(a.get('last_login'))
    return jsonify({'success': True, 'list': admins, 'total': total})


@admin_bp.route('/admins', methods=['POST'])
@admin_required('admins')
def admin_create():
    """创建管理员"""
    data = request.json or {}
    username = (data.get('username', '') or '').strip()
    password = data.get('password', '')
    role = data.get('role', 'readonly')
    email = data.get('email', '')
    if not username or not password:
        return jsonify({'success': False, 'message': '用户名和密码不能为空'})
    if len(password) < 6:
        return jsonify({'success': False, 'message': '密码至少6位'})
    admin_id, msg = admin_db.create_admin(username, password, role, email)
    if admin_id:
        _log_op('admins', '创建管理员', f'用户名:{username} 角色:{role}')
        return jsonify({'success': True, 'message': '创建成功'})
    return jsonify({'success': False, 'message': msg})


@admin_bp.route('/admins/<int:aid>', methods=['PUT'])
@admin_required('admins')
def admin_update(aid):
    """更新管理员（角色/状态/邮箱）"""
    data = request.json or {}
    ok = admin_db.update_admin(aid, role=data.get('role'), status=data.get('status'), email=data.get('email'))
    if ok:
        _log_op('admins', '更新管理员', f'ID:{aid} 数据:{json.dumps(data, ensure_ascii=False)}')
    return jsonify({'success': ok})


@admin_bp.route('/admins/<int:aid>/reset-password', methods=['POST'])
@admin_required('admins')
def admin_reset_pw(aid):
    """重置管理员密码"""
    data = request.json or {}
    new_pw = data.get('password', '')
    if len(new_pw) < 6:
        return jsonify({'success': False, 'message': '密码至少6位'})
    admin_db.reset_admin_password(aid, new_pw)
    _log_op('admins', '重置管理员密码', f'ID:{aid}')
    return jsonify({'success': True, 'message': '密码已重置'})


@admin_bp.route('/admins/<int:aid>', methods=['DELETE'])
@admin_required('admins')
def admin_delete(aid):
    """删除管理员"""
    ok, msg = admin_db.delete_admin(aid)
    if ok:
        _log_op('admins', '删除管理员', f'ID:{aid}')
    return jsonify({'success': ok, 'message': msg})


# ========== 3. 角色管理 ==========

@admin_bp.route('/roles', methods=['GET'])
@admin_required()
def role_list():
    """角色列表"""
    roles = admin_db.list_roles()
    for r in roles:
        r['permissions'] = json.loads(r['permissions'])
    return jsonify({'success': True, 'list': roles})


# ========== 4. 仪表盘 ==========

@admin_bp.route('/dashboard', methods=['GET'])
@admin_required('dashboard')
def dashboard():
    """系统仪表盘数据"""
    stats = admin_db.get_dashboard_stats()
    # 加载网站用户数
    site_users = _load_site_users()
    stats['site_user_count'] = len(site_users)
    # 统计自选总数
    fav_total = sum(len(u.get('favorites', [])) for u in site_users.values())
    stats['fav_total'] = fav_total
    # 统计持仓总数
    holding_total = sum(len(u.get('holdings', [])) for u in site_users.values())
    stats['holding_total'] = holding_total
    stats['uptime_str'] = _fmt_duration(stats.get('system_uptime', 0))
    # 最近操作日志5条
    recent_ops, _ = admin_db.list_operation_logs(1, 5)
    for op in recent_ops:
        op['time_str'] = _fmt_time(op.get('create_time'))
    stats['recent_ops'] = recent_ops
    return jsonify({'success': True, 'data': stats})


def _fmt_duration(secs):
    if secs < 60:
        return f'{int(secs)}秒'
    if secs < 3600:
        return f'{int(secs/60)}分钟'
    if secs < 86400:
        return f'{int(secs/3600)}小时{int((secs%3600)/60)}分'
    return f'{int(secs/86400)}天{int((secs%86400)/3600)}小时'


# ========== 5. 网站用户管理 ==========

@admin_bp.route('/site-users', methods=['GET'])
@admin_required('users')
def site_user_list():
    """网站用户列表"""
    page = int(request.args.get('page', 1))
    size = int(request.args.get('size', 20))
    keyword = request.args.get('keyword', '').strip()
    users = _load_site_users()
    user_list = []
    for username, u in users.items():
        if keyword and keyword not in username:
            continue
        user_list.append({
            'username': username,
            'favorites_count': len(u.get('favorites', [])),
            'holdings_count': len(u.get('holdings', [])),
            'create_time': u.get('createTime', 0),
            'create_time_str': _fmt_time(u.get('createTime')),
            'recreated': u.get('recreated', False),
        })
    user_list.sort(key=lambda x: x.get('create_time', 0), reverse=True)
    total = len(user_list)
    offset = (page - 1) * size
    user_list = user_list[offset:offset + size]
    return jsonify({'success': True, 'list': user_list, 'total': total})


@admin_bp.route('/site-users/<username>', methods=['GET'])
@admin_required('users')
def site_user_detail(username):
    """查看用户详情（自选+持仓）"""
    users = _load_site_users()
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': '用户不存在'}), 404
    return jsonify({
        'success': True,
        'user': {
            'username': username,
            'favorites': user.get('favorites', []),
            'groups': user.get('groups', ['全部']),
            'holdings': user.get('holdings', []),
            'create_time_str': _fmt_time(user.get('createTime')),
        }
    })


@admin_bp.route('/site-users/<username>/reset-password', methods=['POST'])
@admin_required('users')
def site_user_reset_pw(username):
    """重置网站用户密码"""
    data = request.json or {}
    new_pw = data.get('password', '')
    if len(new_pw) < 6:
        return jsonify({'success': False, 'message': '密码至少6位'})
    users = _load_site_users()
    if username not in users:
        return jsonify({'success': False, 'message': '用户不存在'}), 404
    import hashlib, random
    salt = str(random.randint(100000, 999999))
    users[username]['password'] = hashlib.sha256((salt + new_pw + 'fund_salt_2026').encode()).hexdigest()
    users[username]['salt'] = salt
    users[username]['recreated'] = False
    _save_site_users(users)
    _log_op('users', '重置用户密码', f'用户:{username}')
    return jsonify({'success': True, 'message': f'密码已重置为: {new_pw}'})


@admin_bp.route('/site-users/<username>', methods=['DELETE'])
@admin_required('users')
def site_user_delete(username):
    """删除网站用户"""
    users = _load_site_users()
    if username not in users:
        return jsonify({'success': False, 'message': '用户不存在'}), 404
    del users[username]
    _save_site_users(users)
    _log_op('users', '删除用户', f'用户:{username}')
    return jsonify({'success': True, 'message': '用户已删除'})


@admin_bp.route('/site-users/<username>/favorites', methods=['DELETE'])
@admin_required('users')
def site_user_clear_fav(username):
    """清空用户自选"""
    users = _load_site_users()
    if username not in users:
        return jsonify({'success': False, 'message': '用户不存在'}), 404
    users[username]['favorites'] = []
    _save_site_users(users)
    _log_op('users', '清空用户自选', f'用户:{username}')
    return jsonify({'success': True, 'message': '已清空自选'})


# ========== 6. 自选数据统计 ==========

@admin_bp.route('/favorites/stats', methods=['GET'])
@admin_required('favorites')
def favorites_stats():
    """自选数据统计 - 热门基金排行"""
    users = _load_site_users()
    fund_count = {}
    for u in users.values():
        for fav in u.get('favorites', []):
            code = fav if isinstance(fav, str) else fav.get('code', '')
            if code:
                fund_count[code] = fund_count.get(code, 0) + 1
    # 排序取前50
    hot = sorted(fund_count.items(), key=lambda x: x[1], reverse=True)[:50]
    result = [{'code': c, 'count': n} for c, n in hot]
    total_users = len(users)
    total_favs = sum(len(u.get('favorites', [])) for u in users.values())
    return jsonify({
        'success': True,
        'data': {
            'hot_funds': result,
            'total_users': total_users,
            'total_favorites': total_favs,
            'unique_funds': len(fund_count),
        }
    })


# ========== 7. 搜索统计 ==========

@admin_bp.route('/search/stats', methods=['GET'])
@admin_required('search_stats')
def search_stats():
    """搜索行为统计"""
    days = int(request.args.get('days', 7))
    stats = admin_db.get_search_stats(days)
    return jsonify({'success': True, 'data': stats})


@admin_bp.route('/search/logs', methods=['GET'])
@admin_required('search_stats')
def search_logs():
    """搜索日志列表"""
    page = int(request.args.get('page', 1))
    size = int(request.args.get('size', 20))
    logs, total = admin_db.list_search_logs(page, size)
    for l in logs:
        l['time_str'] = _fmt_time(l.get('create_time'))
    return jsonify({'success': True, 'list': logs, 'total': total})


# ========== 8. 基金数据管理 ==========

@admin_bp.route('/funds', methods=['GET'])
@admin_required('funds')
def fund_list():
    """基金缓存数据列表"""
    page = int(request.args.get('page', 1))
    size = int(request.args.get('size', 20))
    keyword = request.args.get('keyword', '').strip()
    status = request.args.get('status', '').strip() or None
    funds, total = admin_db.list_fund_cache(page, size, keyword, status)
    for f in funds:
        f['update_time_str'] = _fmt_time(f.get('update_time'))
    return jsonify({'success': True, 'list': funds, 'total': total})


@admin_bp.route('/funds/refresh', methods=['POST'])
@admin_required('funds')
def fund_refresh():
    """手动刷新单只基金净值（触发采集并写入缓存）"""
    data = request.json or {}
    code = (data.get('code', '') or '').strip()
    if not code:
        return jsonify({'success': False, 'message': '请输入基金代码'})
    try:
        import requests as req
        url = f'https://fundgz.1234567.com.cn/js/{code}.js'
        resp = req.get(url, params={'rt': int(time.time() * 1000)}, timeout=8,
                       headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fund.eastmoney.com/'})
        import re
        match = re.search(r'jsonpgz\((.+)\)', resp.text.strip())
        if match:
            d = json.loads(match.group(1))
            def sf(v):
                try: return float(v)
                except: return 0.0
            admin_db.upsert_fund_cache(
                code=code, name=d.get('name', ''),
                net_value=sf(d.get('dwjz')), change=sf(d.get('gszzl')),
                net_value_date=d.get('jzrq', '')
            )
            _log_op('funds', '手动刷新基金', f'代码:{code}')
            return jsonify({'success': True, 'message': '刷新成功', 'data': d})
        return jsonify({'success': False, 'message': '未获取到数据'})
    except Exception as e:
        return jsonify({'success': False, 'message': f'刷新失败: {e}'})


@admin_bp.route('/funds/<code>', methods=['PUT'])
@admin_required('funds')
def fund_update(code):
    """手动修正基金数据"""
    data = request.json or {}
    existing, _ = admin_db.list_fund_cache(1, 1, code)
    if not existing:
        return jsonify({'success': False, 'message': '基金不存在于缓存'}), 404
    f = existing[0]
    admin_db.upsert_fund_cache(
        code=code,
        name=data.get('name', f.get('name', '')),
        type=data.get('type', f.get('type', '')),
        company=data.get('company', f.get('company', '')),
        manager=data.get('manager', f.get('manager', '')),
        status=data.get('status', f.get('status', 'normal')),
        net_value=float(data.get('net_value', f.get('net_value', 0)) or 0),
        net_value_date=data.get('net_value_date', f.get('net_value_date', '')),
    )
    _log_op('funds', '修正基金数据', f'代码:{code}')
    return jsonify({'success': True, 'message': '已更新'})


# ========== 9. 净值数据监控 ==========

@admin_bp.route('/nav/monitor', methods=['GET'])
@admin_required('nav')
def nav_monitor():
    """净值数据监控 - 异常检测"""
    funds, total = admin_db.list_fund_cache(1, 200)
    anomalies = []
    threshold = float(admin_db.get_config('nav_deviation_threshold', '5'))
    for f in funds:
        issues = []
        if f.get('net_value', 0) == 0:
            issues.append('净值为空')
        if abs(f.get('change', 0)) > threshold:
            issues.append(f'涨幅异常({f.get("change", 0):.2f}%)')
        if not f.get('net_value_date'):
            issues.append('净值日期缺失')
        if issues:
            f['issues'] = issues
            f['update_time_str'] = _fmt_time(f.get('update_time'))
            anomalies.append(f)
    return jsonify({
        'success': True,
        'data': {
            'anomalies': anomalies,
            'total_checked': total,
            'anomaly_count': len(anomalies),
            'threshold': threshold,
        }
    })


# ========== 10. 采集任务管理 ==========

@admin_bp.route('/tasks', methods=['GET'])
@admin_required('tasks')
def task_list():
    """采集任务列表"""
    tasks = admin_db.list_collection_tasks()
    for t in tasks:
        t['last_run_str'] = _fmt_time(t.get('last_run_time'))
        t['create_time_str'] = _fmt_time(t.get('create_time'))
        t['config_obj'] = json.loads(t.get('config', '{}'))
    return jsonify({'success': True, 'list': tasks})


@admin_bp.route('/tasks/<int:tid>', methods=['PUT'])
@admin_required('tasks')
def task_update(tid):
    """更新采集任务配置"""
    data = request.json or {}
    updates = {}
    for k in ('name', 'description', 'cron'):
        if k in data:
            updates[k] = data[k]
    if 'config' in data:
        updates['config'] = json.dumps(data['config'], ensure_ascii=False) if isinstance(data['config'], dict) else data['config']
    if 'status' in data:
        updates['status'] = 1 if data['status'] else 0
    if updates:
        admin_db.update_collection_task(tid, **updates)
        _log_op('tasks', '更新采集任务', f'ID:{tid}')
    return jsonify({'success': True, 'message': '已更新'})


@admin_bp.route('/tasks/<int:tid>/toggle', methods=['POST'])
@admin_required('tasks')
def task_toggle(tid):
    """启停采集任务"""
    data = request.json or {}
    enabled = data.get('enabled', False)
    admin_db.toggle_collection_task(tid, enabled)
    _log_op('tasks', '启停采集任务', f'ID:{tid} 状态:{"开启" if enabled else "关闭"}')
    return jsonify({'success': True, 'message': f'已{"开启" if enabled else "关闭"}'})


@admin_bp.route('/tasks/<int:tid>/run', methods=['POST'])
@admin_required('tasks')
def task_run(tid):
    """手动触发采集任务"""
    tasks = admin_db.list_collection_tasks()
    task = next((t for t in tasks if t['id'] == tid), None)
    if not task:
        return jsonify({'success': False, 'message': '任务不存在'}), 404
    start_time = time.time()
    try:
        # 实际触发采集（这里复用 server.py 的采集逻辑）
        records = 0
        detail = ''
        task_code = task['code']
        if task_code == 'full_fund_crawl':
            # 采集基金排行前500作为全量采集演示
            try:
                import requests as req
                import re
                url = 'https://fund.eastmoney.com/data/rankhandler.aspx'
                params = {'op': 'ph', 'dt': 'kf', 'ft': 'all', 'rs': '', 'gs': 0, 'sc': 'rzdf', 'st': 'desc', 'pi': 1, 'pn': 500, 'dx': 1}
                headers = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fund.eastmoney.com/data/fundranking.html'}
                resp = req.get(url, params=params, headers=headers, timeout=15)
                match = re.search(r'datas:\[(.+?)\]', resp.text, re.DOTALL)
                if match:
                    raw_items = match.group(1).split('","')
                    for raw in raw_items:
                        raw = raw.strip('"').strip()
                        if not raw:
                            continue
                        parts = raw.split(',')
                        if len(parts) >= 7:
                            admin_db.upsert_fund_cache(
                                code=parts[0], name=parts[1],
                                type=parts[2] if len(parts) > 2 else '',
                                net_value=float(parts[4]) if len(parts) > 4 else 0,
                                change=float(parts[6]) if len(parts) > 6 else 0,
                            )
                            records += 1
                    detail = f'采集到{records}只基金'
            except Exception as e:
                detail = f'采集异常: {e}'
        elif task_code == 'intraday_nav':
            # 盘中采集：刷新已缓存基金的估值
            funds, _ = admin_db.list_fund_cache(1, 100)
            for f in funds:
                try:
                    import requests as req
                    import re
                    url = f'https://fundgz.1234567.com.cn/js/{f["code"]}.js'
                    resp = req.get(url, params={'rt': int(time.time()*1000)}, timeout=5,
                                   headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fund.eastmoney.com/'})
                    m = re.search(r'jsonpgz\((.+)\)', resp.text.strip())
                    if m:
                        d = json.loads(m.group(1))
                        def sf(v):
                            try: return float(v)
                            except: return 0.0
                        admin_db.upsert_fund_cache(
                            code=f['code'], name=d.get('name', f.get('name', '')),
                            net_value=sf(d.get('dwjz')), change=sf(d.get('gszzl')),
                            net_value_date=d.get('jzrq', '')
                        )
                        records += 1
                except:
                    pass
            detail = f'更新了{records}只基金估值'
        else:
            detail = '任务已触发（演示模式）'
            records = 0

        admin_db.record_collection_run(tid, task['name'], task_code, 'success', start_time, records, detail)
        _log_op('tasks', '手动触发采集', f'任务:{task["name"]} 结果:{records}条')
        return jsonify({'success': True, 'message': detail or '任务执行完成', 'records': records})
    except Exception as e:
        admin_db.record_collection_run(tid, task['name'], task_code, 'fail', start_time, 0, '', str(e))
        return jsonify({'success': False, 'message': f'执行失败: {e}'})


@admin_bp.route('/tasks/<int:tid>/logs', methods=['GET'])
@admin_required('tasks')
def task_logs(tid):
    """采集任务日志"""
    page = int(request.args.get('page', 1))
    size = int(request.args.get('size', 20))
    logs, total = admin_db.list_collection_logs(page, size, tid)
    for l in logs:
        l['start_str'] = _fmt_time(l.get('start_time'))
        l['duration_str'] = f'{l.get("duration", 0):.1f}s'
    return jsonify({'success': True, 'list': logs, 'total': total})


@admin_bp.route('/collection-logs', methods=['GET'])
@admin_required('tasks')
def all_collection_logs():
    """所有采集日志"""
    page = int(request.args.get('page', 1))
    size = int(request.args.get('size', 20))
    logs, total = admin_db.list_collection_logs(page, size)
    for l in logs:
        l['start_str'] = _fmt_time(l.get('start_time'))
        l['duration_str'] = f'{l.get("duration", 0):.1f}s'
    return jsonify({'success': True, 'list': logs, 'total': total})


# ========== 11. 数据源管理 ==========

@admin_bp.route('/data-sources', methods=['GET'])
@admin_required('sources')
def ds_list():
    """数据源列表"""
    sources = admin_db.list_data_sources()
    for s in sources:
        s['create_time_str'] = _fmt_time(s.get('create_time'))
        s['update_time_str'] = _fmt_time(s.get('update_time'))
    return jsonify({'success': True, 'list': sources})


@admin_bp.route('/data-sources', methods=['POST'])
@admin_required('sources')
def ds_add():
    """新增数据源"""
    data = request.json or {}
    name = data.get('name', '')
    typ = data.get('type', '')
    url = data.get('url', '')
    if not name or not url:
        return jsonify({'success': False, 'message': '名称和URL不能为空'})
    admin_db.add_data_source(name, typ, url, data.get('priority', 1),
                             data.get('timeout', 10), data.get('interval', 0), data.get('remark', ''))
    _log_op('sources', '新增数据源', f'名称:{name}')
    return jsonify({'success': True, 'message': '已添加'})


@admin_bp.route('/data-sources/<int:dsid>', methods=['PUT'])
@admin_required('sources')
def ds_update(dsid):
    """更新数据源"""
    data = request.json or {}
    admin_db.update_data_source(dsid, **data)
    _log_op('sources', '更新数据源', f'ID:{dsid}')
    return jsonify({'success': True, 'message': '已更新'})


@admin_bp.route('/data-sources/<int:dsid>', methods=['DELETE'])
@admin_required('sources')
def ds_delete(dsid):
    """删除数据源"""
    admin_db.delete_data_source(dsid)
    _log_op('sources', '删除数据源', f'ID:{dsid}')
    return jsonify({'success': True, 'message': '已删除'})


@admin_bp.route('/data-sources/<int:dsid>/test', methods=['POST'])
@admin_required('sources')
def ds_test(dsid):
    """数据源连通性检测"""
    sources = admin_db.list_data_sources()
    ds = next((s for s in sources if s['id'] == dsid), None)
    if not ds:
        return jsonify({'success': False, 'message': '数据源不存在'}), 404
    try:
        import requests as req
        start = time.time()
        test_url = ds['url'].replace('{code}', '000001')  # 替换占位符
        resp = req.get(test_url, timeout=ds.get('timeout', 10),
                       headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fund.eastmoney.com/'})
        elapsed = time.time() - start
        ok = resp.status_code == 200
        _log_op('sources', '测试数据源', f'ID:{dsid} 结果:{"成功" if ok else "失败"}')
        return jsonify({
            'success': True,
            'data': {
                'reachable': ok,
                'status_code': resp.status_code,
                'response_time': f'{elapsed:.2f}s',
                'content_length': len(resp.content),
            }
        })
    except Exception as e:
        return jsonify({'success': True, 'data': {'reachable': False, 'error': str(e)}})


# ========== 12. 系统配置 ==========

@admin_bp.route('/config', methods=['GET'])
@admin_required('config')
def config_get():
    """获取系统配置"""
    configs = admin_db.get_all_config()
    return jsonify({'success': True, 'data': configs})


@admin_bp.route('/config', methods=['POST'])
@admin_required('config')
def config_set():
    """更新系统配置（批量）"""
    data = request.json or {}
    configs = data.get('configs', {})
    for key, value in configs.items():
        admin_db.set_config(key, str(value), g.admin['username'])
    _log_op('config', '更新系统配置', f'更新{len(configs)}项配置')
    return jsonify({'success': True, 'message': '配置已保存'})


# ========== 13. 日志 ==========

@admin_bp.route('/logs/login', methods=['GET'])
@admin_required('logs')
def logs_login():
    """登录日志"""
    page = int(request.args.get('page', 1))
    size = int(request.args.get('size', 20))
    logs, total = admin_db.list_login_logs(page, size)
    for l in logs:
        l['time_str'] = _fmt_time(l.get('create_time'))
    return jsonify({'success': True, 'list': logs, 'total': total})


@admin_bp.route('/logs/operation', methods=['GET'])
@admin_required('logs')
def logs_operation():
    """操作日志"""
    page = int(request.args.get('page', 1))
    size = int(request.args.get('size', 20))
    module = request.args.get('module', '').strip() or None
    logs, total = admin_db.list_operation_logs(page, size, module)
    for l in logs:
        l['time_str'] = _fmt_time(l.get('create_time'))
    return jsonify({'success': True, 'list': logs, 'total': total})


# ========== 14. 缓存与性能监控 ==========

@admin_bp.route('/cache/status', methods=['GET'])
@admin_required('cache')
def cache_status():
    """缓存状态（内存缓存的板块数据等）"""
    # 从 server.py 导入缓存数据
    try:
        import server
        sector_cache_info = []
        for key, val in server._sector_cache.items():
            sector_cache_info.append({
                'key': key,
                'age': f'{time.time() - val["time"]:.0f}s',
                'items': len(val.get('data', [])),
            })
        email_code_count = len(server._email_codes)
    except Exception:
        sector_cache_info = []
        email_code_count = 0
    return jsonify({
        'success': True,
        'data': {
            'sector_cache': sector_cache_info,
            'email_code_pending': email_code_count,
            'db_path': admin_db.DB_PATH,
            'db_size': f'{os.path.getsize(admin_db.DB_PATH) / 1024:.1f}KB' if os.path.exists(admin_db.DB_PATH) else '0KB',
        }
    })


@admin_bp.route('/cache/sector/clear', methods=['POST'])
@admin_required('cache')
def cache_clear_sector():
    """清除板块缓存"""
    try:
        import server
        server._sector_cache.clear()
        _log_op('cache', '清除板块缓存')
        return jsonify({'success': True, 'message': '板块缓存已清除'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


# ========== 15. 菜单权限定义 ==========

@admin_bp.route('/menu', methods=['GET'])
@admin_required()
def menu():
    """返回当前管理员可见菜单"""
    admin = g.admin
    perms = admin_db._get_permissions(admin['role'])
    is_super = '*' in perms

    all_menus = [
        {'key': 'dashboard', 'title': '系统仪表盘', 'icon': 'dashboard', 'perm': 'dashboard'},
        {'key': 'users', 'title': '网站用户管理', 'icon': 'users', 'perm': 'users'},
        {'key': 'admins', 'title': '管理员管理', 'icon': 'admin', 'perm': 'admins', 'super_only': True},
        {'key': 'funds', 'title': '基金数据管理', 'icon': 'fund', 'perm': 'funds'},
        {'key': 'nav', 'title': '净值数据监控', 'icon': 'chart', 'perm': 'nav'},
        {'key': 'favorites', 'title': '自选数据统计', 'icon': 'star', 'perm': 'favorites'},
        {'key': 'search_stats', 'title': '搜索行为统计', 'icon': 'search', 'perm': 'search_stats'},
        {'key': 'tasks', 'title': '采集任务管理', 'icon': 'task', 'perm': 'tasks'},
        {'key': 'sources', 'title': '数据源管理', 'icon': 'database', 'perm': 'sources'},
        {'key': 'cache', 'title': '缓存与性能', 'icon': 'server', 'perm': 'cache'},
        {'key': 'config', 'title': '系统配置', 'icon': 'setting', 'perm': 'config'},
        {'key': 'logs', 'title': '日志管理', 'icon': 'log', 'perm': 'logs'},
    ]

    visible = []
    for m in all_menus:
        if m.get('super_only') and not is_super:
            continue
        if is_super or m['perm'] in perms:
            visible.append(m)

    return jsonify({'success': True, 'list': visible})
