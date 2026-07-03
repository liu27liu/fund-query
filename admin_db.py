#!/usr/bin/env python3
"""
后台管理数据库层 - SQLite
管理员账户、角色权限、操作日志、搜索日志、系统配置、数据源、采集任务等
"""
import os
import json
import time
import hashlib
import random
import sqlite3
from datetime import datetime, timedelta

# 数据库路径：优先 /data (Railway volume)，其次项目目录
_DB_DIR = '/data' if os.path.isdir('/data') else os.path.dirname(os.path.abspath(__file__))
os.makedirs(_DB_DIR, exist_ok=True)
DB_PATH = os.path.join(_DB_DIR, 'admin.db')

_token_secret = 'admin_fund_query_2026_v1'


def _get_conn():
    """获取数据库连接"""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def init_db():
    """初始化数据库表结构 + 默认数据"""
    conn = _get_conn()
    c = conn.cursor()

    # ========== 管理员表 ==========
    c.execute('''
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'readonly',
            status INTEGER NOT NULL DEFAULT 1,
            email TEXT DEFAULT '',
            create_time REAL NOT NULL,
            last_login REAL,
            last_login_ip TEXT DEFAULT ''
        )
    ''')

    # ========== 角色定义表 ==========
    c.execute('''
        CREATE TABLE IF NOT EXISTS admin_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            permissions TEXT NOT NULL DEFAULT '[]',
            description TEXT DEFAULT '',
            is_system INTEGER DEFAULT 0
        )
    ''')

    # ========== 登录日志 ==========
    c.execute('''
        CREATE TABLE IF NOT EXISTS admin_login_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER,
            username TEXT NOT NULL,
            ip TEXT DEFAULT '',
            user_agent TEXT DEFAULT '',
            status TEXT NOT NULL,
            message TEXT DEFAULT '',
            create_time REAL NOT NULL
        )
    ''')

    # ========== 操作日志 ==========
    c.execute('''
        CREATE TABLE IF NOT EXISTS admin_operation_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER,
            username TEXT NOT NULL,
            module TEXT NOT NULL,
            action TEXT NOT NULL,
            detail TEXT DEFAULT '',
            ip TEXT DEFAULT '',
            create_time REAL NOT NULL
        )
    ''')

    # ========== 用户搜索日志 ==========
    c.execute('''
        CREATE TABLE IF NOT EXISTS search_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            keyword TEXT NOT NULL,
            ip TEXT DEFAULT '',
            user_agent TEXT DEFAULT '',
            result_count INTEGER DEFAULT 0,
            create_time REAL NOT NULL
        )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_search_time ON search_logs(create_time)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_search_keyword ON search_logs(keyword)')

    # ========== 系统配置表 ==========
    c.execute('''
        CREATE TABLE IF NOT EXISTS system_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            description TEXT DEFAULT '',
            update_time REAL NOT NULL,
            updated_by TEXT DEFAULT ''
        )
    ''')

    # ========== 数据源管理表 ==========
    c.execute('''
        CREATE TABLE IF NOT EXISTS data_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            url TEXT NOT NULL,
            priority INTEGER DEFAULT 1,
            timeout INTEGER DEFAULT 10,
            interval INTEGER DEFAULT 0,
            status INTEGER DEFAULT 1,
            remark TEXT DEFAULT '',
            create_time REAL NOT NULL,
            update_time REAL
        )
    ''')

    # ========== 采集任务表 ==========
    c.execute('''
        CREATE TABLE IF NOT EXISTS collection_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            code TEXT UNIQUE NOT NULL,
            type TEXT NOT NULL,
            description TEXT DEFAULT '',
            cron TEXT DEFAULT '',
            config TEXT DEFAULT '{}',
            status INTEGER DEFAULT 0,
            last_run_time REAL,
            last_run_status TEXT DEFAULT '',
            last_run_duration REAL DEFAULT 0,
            last_records INTEGER DEFAULT 0,
            create_time REAL NOT NULL,
            update_time REAL
        )
    ''')

    # ========== 采集日志表 ==========
    c.execute('''
        CREATE TABLE IF NOT EXISTS collection_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER,
            task_name TEXT NOT NULL,
            task_code TEXT NOT NULL,
            status TEXT NOT NULL,
            start_time REAL NOT NULL,
            end_time REAL,
            duration REAL DEFAULT 0,
            records INTEGER DEFAULT 0,
            detail TEXT DEFAULT '',
            error TEXT DEFAULT ''
        )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_collog_time ON collection_logs(start_time)')

    # ========== 基金数据缓存表 ==========
    c.execute('''
        CREATE TABLE IF NOT EXISTS fund_cache (
            code TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            type TEXT DEFAULT '',
            company TEXT DEFAULT '',
            manager TEXT DEFAULT '',
            status TEXT DEFAULT 'normal',
            net_value REAL DEFAULT 0,
            total_net_value REAL DEFAULT 0,
            net_value_date TEXT DEFAULT '',
            change REAL DEFAULT 0,
            update_time REAL
        )
    ''')

    # ========== 公告表 ==========
    c.execute('''
        CREATE TABLE IF NOT EXISTS announcements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            type TEXT DEFAULT 'info',
            link TEXT DEFAULT '',
            sort_order INTEGER DEFAULT 0,
            status INTEGER DEFAULT 1,
            start_time REAL,
            end_time REAL,
            create_time REAL NOT NULL,
            update_time REAL
        )
    ''')

    conn.commit()

    # ========== 初始化默认角色 ==========
    roles = c.execute('SELECT COUNT(*) FROM admin_roles').fetchone()[0]
    if roles == 0:
        default_roles = [
            ('superadmin', '超级管理员', json.dumps(['*']), '拥有所有权限', 1),
            ('operator', '运营管理员', json.dumps([
                'dashboard', 'announcements', 'users', 'funds', 'nav', 'favorites',
                'search_stats', 'tasks', 'sources', 'config'
            ]), '可管理用户、基金、任务、配置，不可管理管理员', 1),
            ('readonly', '只读运维', json.dumps([
                'dashboard', 'announcements', 'users', 'funds', 'nav', 'favorites',
                'search_stats', 'tasks', 'sources'
            ]), '只能查看数据，不能修改', 1),
        ]
        for code, name, perms, desc, is_sys in default_roles:
            c.execute('INSERT INTO admin_roles (code, name, permissions, description, is_system) VALUES (?,?,?,?,?)',
                      (code, name, perms, desc, is_sys))

    # ========== 初始化默认超管账户 ==========
    admin_count = c.execute('SELECT COUNT(*) FROM admins').fetchone()[0]
    if admin_count == 0:
        salt = str(random.randint(100000, 999999))
        default_password = os.environ.get('ADMIN_DEFAULT_PASSWORD', 'admin123')
        default_username = os.environ.get('ADMIN_DEFAULT_USERNAME', 'liuzhengpin')
        c.execute('INSERT INTO admins (username, password_hash, salt, role, status, email, create_time) VALUES (?,?,?,?,?,?,?)',
                  (default_username, _hash_pw(default_password, salt), salt, 'superadmin', 1, '', time.time()))
        print(f'[AdminDB] 默认超管账户已创建: {default_username} / {default_password}', flush=True)
    else:
        # 迁移：将旧默认账户 admin 重命名为 liuzhengpin
        default_username = os.environ.get('ADMIN_DEFAULT_USERNAME', 'liuzhengpin')
        old_admin = c.execute('SELECT id FROM admins WHERE username=?', ('admin',)).fetchone()
        new_exists = c.execute('SELECT id FROM admins WHERE username=?', (default_username,)).fetchone()
        if old_admin and not new_exists:
            c.execute('UPDATE admins SET username=? WHERE id=?', (default_username, old_admin[0]))
            print(f'[AdminDB] 默认超管账户已重命名: admin -> {default_username}', flush=True)

    # ========== 初始化默认系统配置 ==========
    config_count = c.execute('SELECT COUNT(*) FROM system_config').fetchone()[0]
    if config_count == 0:
        default_configs = [
            ('site_name', '基金净值通', '网站名称'),
            ('site_logo', '/assets/logo.jpg', '网站LOGO路径'),
            ('site_seo_keywords', '基金净值,实时估值,基金排名,持仓盈亏', 'SEO关键词'),
            ('site_seo_description', '轻量级基金净值查询平台，覆盖全市场基金', 'SEO描述'),
            ('trading_start_time', '09:30', '交易开始时间'),
            ('trading_end_time', '15:00', '交易结束时间'),
            ('nav_deviation_threshold', '5', '估值偏差告警阈值(%)'),
            ('alert_email', '', '告警通知邮箱'),
            ('collection_interval_intraday', '120', '盘中采集间隔(秒)'),
            ('collection_interval_postclose', '3600', '盘后采集间隔(秒)'),
        ]
        for key, value, desc in default_configs:
            c.execute('INSERT INTO system_config (key, value, description, update_time) VALUES (?,?,?,?)',
                      (key, value, desc, time.time()))

    # ========== 追加站点文案配置（增量，不覆盖已有值）==========
    site_text_configs = [
        # --- 页眉 ---
        ('text_header_logo', '基金净值通', '页眉Logo文字'),
        ('text_nav_home', '首页', '导航-首页'),
        ('text_nav_portfolio', '持仓', '导航-持仓'),
        ('text_nav_favorites', '自选', '导航-自选'),
        ('text_nav_search', '搜索', '导航-搜索'),
        ('text_search_placeholder', '输入基金代码 / 名称 / 拼音首字母', '搜索框占位符'),
        ('text_login_btn', '登录', '登录按钮文字'),
        # --- 页脚 ---
        ('text_footer_main', '基金净值通 · 实时估值查询平台', '页脚主文字'),
        ('text_footer_time_prefix', '当前时间: ', '页脚时间前缀'),
        # --- 首页 Hero ---
        ('text_hero_title', '基金净值通 · 实时估值查询平台', '首页大标题'),
        ('text_hero_subtitle', '覆盖全市场基金 · 盘中实时估值 · 历史净值走势 · 自选基金管理', '首页副标题'),
        ('text_hero_stat1_num', '10000+', '首页统计1-数值'),
        ('text_hero_stat1_label', '覆盖基金', '首页统计1-标签'),
        ('text_hero_stat2_num', '3s', '首页统计2-数值'),
        ('text_hero_stat2_label', '估值更新', '首页统计2-标签'),
        ('text_hero_stat3_num', '24h', '首页统计3-数值'),
        ('text_hero_stat3_label', '数据采集', '首页统计3-标签'),
        # --- 门户卡片 ---
        ('text_portal_market_title', '大盘指数', '门户卡片-大盘指数标题'),
        ('text_portal_market_desc', 'A股 · 美股 · 全球实时行情', '门户卡片-大盘指数描述'),
        ('text_portal_sector_title', '行业板块', '门户卡片-行业板块标题'),
        ('text_portal_sector_desc', '赛道行情 · 涨跌排名', '门户卡片-行业板块描述'),
        ('text_portal_ranking_title', '基金榜单', '门户卡片-基金榜单标题'),
        ('text_portal_ranking_desc', '日涨跌 · 周涨幅 · 年涨幅', '门户卡片-基金榜单描述'),
        ('text_portal_news_title', '实时资讯', '门户卡片-实时资讯标题'),
        ('text_portal_news_desc', '7×24小时财经快讯', '门户卡片-实时资讯描述'),
        # --- 版块标题 ---
        ('text_section_market', '大盘指数实时看板', '版块标题-大盘指数'),
        ('text_section_sector', '赛道行业板块实时行情', '版块标题-行业板块'),
        ('text_section_ranking', '基金榜单', '版块标题-基金榜单'),
        ('text_section_news', '7×24 实时财经资讯', '版块标题-实时资讯'),
        # --- 加载提示 ---
        ('text_loading_data', '正在加载数据...', '首页加载提示'),
        ('text_loading_ranking', '正在加载涨跌排行...', '榜单加载提示'),
        ('text_loading_news', '正在加载实时资讯...', '资讯加载提示'),
        ('text_load_more_news', '加载更多资讯', '加载更多资讯按钮'),
        # --- 浏览器标签 ---
        ('text_page_title', '基金净值通 - 实时估值 · 持仓盈亏 · 自选管理', '浏览器标签页标题'),
    ]
    for key, value, desc in site_text_configs:
        existing = c.execute('SELECT key FROM system_config WHERE key=?', (key,)).fetchone()
        if not existing:
            c.execute('INSERT INTO system_config (key, value, description, update_time) VALUES (?,?,?,?)',
                      (key, value, desc, time.time()))

    # ========== 初始化默认数据源 ==========
    ds_count = c.execute('SELECT COUNT(*) FROM data_sources').fetchone()[0]
    if ds_count == 0:
        default_sources = [
            ('东方财富-基金搜索', 'search', 'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx', 1, 10, 0, 1, '基金搜索主数据源'),
            ('天天基金-实时估值', 'estimate', 'https://fundgz.1234567.com.cn/js/{code}.js', 1, 8, 0, 1, '实时估值主数据源'),
            ('东方财富-历史净值', 'history', 'https://api.fund.eastmoney.com/f10/lsjz', 1, 10, 0, 1, '历史净值主数据源'),
            ('东方财富-基金详情', 'detail', 'https://fundf10.eastmoney.com/jbgk_{code}.html', 1, 10, 0, 1, '基金详情主数据源'),
            ('东方财富-基金排行', 'ranking', 'https://fund.eastmoney.com/data/rankhandler.aspx', 1, 10, 0, 1, '基金排行主数据源'),
            ('东方财富-财经快讯', 'news', 'https://np-listapi.eastmoney.com/comm/web/getFastNewsList', 1, 10, 0, 1, '财经快讯主数据源'),
            ('东方财富-大盘指数', 'indices', 'https://push2.eastmoney.com/api/qt/ulist.np/get', 1, 8, 0, 1, '大盘指数主数据源'),
            ('东方财富-行业板块', 'sectors', 'https://push2.eastmoney.com/api/qt/clist/get', 1, 15, 0, 1, '行业板块主数据源'),
        ]
        for name, typ, url, pri, timeout, interval, status, remark in default_sources:
            c.execute('''INSERT INTO data_sources (name, type, url, priority, timeout, interval, status, remark, create_time)
                         VALUES (?,?,?,?,?,?,?,?,?)''', (name, typ, url, pri, timeout, interval, status, remark, time.time()))

    # ========== 初始化默认采集任务 ==========
    task_count = c.execute('SELECT COUNT(*) FROM collection_tasks').fetchone()[0]
    if task_count == 0:
        default_tasks = [
            ('全量基金采集', 'full_fund_crawl', 'batch', '采集全市场基金基础数据(代码/名称/类型/公司/经理)，上限10000只', '0 2 * * *', '{"enabled": false}', 0),
            ('新发基金监控', 'new_fund_monitor', 'monitor', '自动巡检新发基金并入库', '0 9 * * *', '{"enabled": false}', 0),
            ('盘中净值采集', 'intraday_nav', 'intraday', '交易日高频采集实时估值数据', '*/15 9-15 * * 1-5', '{"enabled": false, "interval": 120}', 0),
            ('盘后净值更新', 'postclose_nav', 'postclose', '每日收盘后同步官方净值', '0 16 * * 1-5', '{"enabled": false}', 0),
            ('基金重仓股采集', 'fund_holdings_crawl', 'batch', '采集基金前十大重仓股及股票持仓比例', '0 3 * * 1-5', '{"enabled": false}', 0),
        ]
        for name, code, typ, desc, cron, config, status in default_tasks:
            c.execute('''INSERT INTO collection_tasks (name, code, type, description, cron, config, status, create_time)
                         VALUES (?,?,?,?,?,?,?,?)''', (name, code, typ, desc, cron, config, status, time.time()))

    # 迁移：更新全量基金采集任务描述
    c.execute("UPDATE collection_tasks SET description=? WHERE code='full_fund_crawl'",
              ('采集全市场基金基础数据(代码/名称/类型/公司/经理)，上限10000只',))

    # ========== 初始化默认公告 ==========
    ann_count = c.execute('SELECT COUNT(*) FROM announcements').fetchone()[0]
    if ann_count == 0:
        default_anns = [
            ('欢迎使用基金净值通', '本平台提供全市场基金实时估值查询、持仓盈亏计算、自选基金管理等功能，数据仅供参考，不构成投资建议。', 'info', '', 0, 1, None, None),
            ('盘中实时估值', '交易日内盘中实时估值数据每3秒更新一次，盘后数据以基金公司公布的官方净值为准。', 'tip', '', 1, 1, None, None),
        ]
        for title, content, typ, link, sort, status, start, end in default_anns:
            c.execute('''INSERT INTO announcements (title, content, type, link, sort_order, status, start_time, end_time, create_time)
                         VALUES (?,?,?,?,?,?,?,?,?)''', (title, content, typ, link, sort, status, start, end, time.time()))

    conn.commit()
    conn.close()
    print('[AdminDB] 数据库初始化完成', flush=True)


# ========== 工具函数 ==========

def _hash_pw(password, salt=''):
    return hashlib.sha256((salt + password + 'admin_salt_2026').encode()).hexdigest()


def _gen_admin_token(admin_id, username, role):
    sign = hashlib.sha256(f'{admin_id}:{username}:{role}:{_token_secret}'.encode()).hexdigest()[:32]
    return f'{admin_id}:{username}:{role}:{sign}'


def _verify_admin_token(token):
    """验证管理员令牌，返回 admin dict 或 None"""
    if not token or token.count(':') < 3:
        return None
    parts = token.split(':', 3)
    if len(parts) != 4:
        return None
    admin_id_str, username, role, sign = parts
    try:
        admin_id = int(admin_id_str)
    except ValueError:
        return None
    expected_sign = hashlib.sha256(f'{admin_id}:{username}:{role}:{_token_secret}'.encode()).hexdigest()[:32]
    if sign != expected_sign:
        return None
    conn = _get_conn()
    row = conn.execute('SELECT * FROM admins WHERE id=? AND username=? AND status=1', (admin_id, username)).fetchone()
    conn.close()
    if not row:
        return None
    return dict(row)


def _get_permissions(role_code):
    """获取角色的权限列表"""
    conn = _get_conn()
    row = conn.execute('SELECT permissions FROM admin_roles WHERE code=?', (role_code,)).fetchone()
    conn.close()
    if not row:
        return []
    return json.loads(row['permissions'])


def _has_permission(admin, perm):
    """检查管理员是否有某权限"""
    perms = _get_permissions(admin['role'])
    return '*' in perms or perm in perms


# ========== 管理员 CRUD ==========

def create_admin(username, password, role, email=''):
    conn = _get_conn()
    try:
        existing = conn.execute('SELECT id FROM admins WHERE username=?', (username,)).fetchone()
        if existing:
            conn.close()
            return None, '用户名已存在'
        salt = str(random.randint(100000, 999999))
        c = conn.execute(
            'INSERT INTO admins (username, password_hash, salt, role, status, email, create_time) VALUES (?,?,?,?,?,?,?)',
            (username, _hash_pw(password, salt), salt, role, 1, email, time.time())
        )
        conn.commit()
        admin_id = c.lastrowid
        conn.close()
        return admin_id, 'ok'
    except Exception as e:
        conn.close()
        return None, str(e)


def verify_admin_login(username, password):
    """验证管理员登录，返回 (admin_dict, token) 或 (None, error_msg)"""
    conn = _get_conn()
    row = conn.execute('SELECT * FROM admins WHERE username=? AND status=1', (username,)).fetchone()
    if not row:
        conn.close()
        return None, '用户名不存在或已禁用'
    admin = dict(row)
    if _hash_pw(password, admin['salt']) != admin['password_hash']:
        conn.close()
        return None, '密码错误'
    token = _gen_admin_token(admin['id'], admin['username'], admin['role'])
    conn.execute('UPDATE admins SET last_login=?, last_login_ip=? WHERE id=?',
                 (time.time(), '', admin['id']))
    conn.commit()
    conn.close()
    return admin, token


def update_admin_password(admin_id, old_password, new_password):
    conn = _get_conn()
    row = conn.execute('SELECT * FROM admins WHERE id=?', (admin_id,)).fetchone()
    if not row:
        conn.close()
        return False, '管理员不存在'
    admin = dict(row)
    if _hash_pw(old_password, admin['salt']) != admin['password_hash']:
        conn.close()
        return False, '原密码错误'
    new_salt = str(random.randint(100000, 999999))
    conn.execute('UPDATE admins SET password_hash=?, salt=? WHERE id=?',
                 (_hash_pw(new_password, new_salt), new_salt, admin_id))
    conn.commit()
    conn.close()
    return True, '密码修改成功'


def reset_admin_password(admin_id, new_password):
    """超管重置其他管理员密码"""
    conn = _get_conn()
    new_salt = str(random.randint(100000, 999999))
    conn.execute('UPDATE admins SET password_hash=?, salt=? WHERE id=?',
                 (_hash_pw(new_password, new_salt), new_salt, admin_id))
    conn.commit()
    conn.close()
    return True


def list_admins(page=1, size=20):
    conn = _get_conn()
    offset = (page - 1) * size
    total = conn.execute('SELECT COUNT(*) FROM admins').fetchone()[0]
    rows = conn.execute('SELECT id, username, role, status, email, create_time, last_login, last_login_ip FROM admins ORDER BY id DESC LIMIT ? OFFSET ?',
                        (size, offset)).fetchall()
    conn.close()
    return [dict(r) for r in rows], total


def update_admin(admin_id, role=None, status=None, email=None):
    conn = _get_conn()
    sets = []
    vals = []
    if role is not None:
        sets.append('role=?')
        vals.append(role)
    if status is not None:
        sets.append('status=?')
        vals.append(status)
    if email is not None:
        sets.append('email=?')
        vals.append(email)
    if not sets:
        conn.close()
        return False
    vals.append(admin_id)
    conn.execute(f'UPDATE admins SET {",".join(sets)} WHERE id=?', vals)
    conn.commit()
    conn.close()
    return True


def delete_admin(admin_id):
    conn = _get_conn()
    admin = conn.execute('SELECT role FROM admins WHERE id=?', (admin_id,)).fetchone()
    if admin and admin['role'] == 'superadmin':
        count = conn.execute("SELECT COUNT(*) FROM admins WHERE role='superadmin' AND status=1").fetchone()[0]
        if count <= 1:
            conn.close()
            return False, '不能删除最后一个超级管理员'
    conn.execute('DELETE FROM admins WHERE id=?', (admin_id,))
    conn.commit()
    conn.close()
    return True, 'ok'


# ========== 角色管理 ==========

def list_roles():
    conn = _get_conn()
    rows = conn.execute('SELECT * FROM admin_roles ORDER BY id').fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_role(code):
    conn = _get_conn()
    row = conn.execute('SELECT * FROM admin_roles WHERE code=?', (code,)).fetchone()
    conn.close()
    return dict(row) if row else None


# ========== 日志 ==========

def add_login_log(admin_id, username, ip, user_agent, status, message=''):
    conn = _get_conn()
    conn.execute('INSERT INTO admin_login_logs (admin_id, username, ip, user_agent, status, message, create_time) VALUES (?,?,?,?,?,?,?)',
                 (admin_id, username, ip, user_agent, status, message, time.time()))
    conn.commit()
    conn.close()


def add_operation_log(admin_id, username, module, action, detail='', ip=''):
    conn = _get_conn()
    conn.execute('INSERT INTO admin_operation_logs (admin_id, username, module, action, detail, ip, create_time) VALUES (?,?,?,?,?,?,?)',
                 (admin_id, username, module, action, detail, ip, time.time()))
    conn.commit()
    conn.close()


def list_login_logs(page=1, size=20):
    conn = _get_conn()
    offset = (page - 1) * size
    total = conn.execute('SELECT COUNT(*) FROM admin_login_logs').fetchone()[0]
    rows = conn.execute('SELECT * FROM admin_login_logs ORDER BY id DESC LIMIT ? OFFSET ?', (size, offset)).fetchall()
    conn.close()
    return [dict(r) for r in rows], total


def list_operation_logs(page=1, size=20, module=None):
    conn = _get_conn()
    offset = (page - 1) * size
    if module:
        total = conn.execute('SELECT COUNT(*) FROM admin_operation_logs WHERE module=?', (module,)).fetchone()[0]
        rows = conn.execute('SELECT * FROM admin_operation_logs WHERE module=? ORDER BY id DESC LIMIT ? OFFSET ?', (module, size, offset)).fetchall()
    else:
        total = conn.execute('SELECT COUNT(*) FROM admin_operation_logs').fetchone()[0]
        rows = conn.execute('SELECT * FROM admin_operation_logs ORDER BY id DESC LIMIT ? OFFSET ?', (size, offset)).fetchall()
    conn.close()
    return [dict(r) for r in rows], total


# ========== 搜索日志 ==========

def add_search_log(keyword, ip='', user_agent='', result_count=0):
    conn = _get_conn()
    conn.execute('INSERT INTO search_logs (keyword, ip, user_agent, result_count, create_time) VALUES (?,?,?,?,?)',
                 (keyword, ip, user_agent, result_count, time.time()))
    conn.commit()
    conn.close()


def get_search_stats(days=7):
    """搜索统计：高频词、总量、无效搜索"""
    conn = _get_conn()
    since = time.time() - days * 86400
    total = conn.execute('SELECT COUNT(*) FROM search_logs WHERE create_time>=?', (since,)).fetchone()[0]
    # 热搜词Top20
    hot_rows = conn.execute(
        'SELECT keyword, COUNT(*) as cnt FROM search_logs WHERE create_time>=? GROUP BY keyword ORDER BY cnt DESC LIMIT 20',
        (since,)
    ).fetchall()
    hot = [{'keyword': r['keyword'], 'count': r['cnt']} for r in hot_rows]
    # 无效搜索（结果为0）
    invalid = conn.execute('SELECT COUNT(*) FROM search_logs WHERE create_time>=? AND result_count=0', (since,)).fetchone()[0]
    # 今日搜索量
    today_start = time.time() - (time.time() % 86400) - 8 * 3600  # UTC+8
    today = conn.execute('SELECT COUNT(*) FROM search_logs WHERE create_time>=?', (today_start,)).fetchone()[0]
    conn.close()
    return {'total': total, 'today': today, 'invalid': invalid, 'hot_keywords': hot}


def list_search_logs(page=1, size=20):
    conn = _get_conn()
    offset = (page - 1) * size
    total = conn.execute('SELECT COUNT(*) FROM search_logs').fetchone()[0]
    rows = conn.execute('SELECT * FROM search_logs ORDER BY id DESC LIMIT ? OFFSET ?', (size, offset)).fetchall()
    conn.close()
    return [dict(r) for r in rows], total


# ========== 系统配置 ==========

def get_all_config():
    conn = _get_conn()
    rows = conn.execute('SELECT * FROM system_config ORDER BY key').fetchall()
    conn.close()
    return {r['key']: {'value': r['value'], 'description': r['description']} for r in rows}


def get_config(key, default=''):
    conn = _get_conn()
    row = conn.execute('SELECT value FROM system_config WHERE key=?', (key,)).fetchone()
    conn.close()
    return row['value'] if row else default


def set_config(key, value, updated_by=''):
    conn = _get_conn()
    existing = conn.execute('SELECT key FROM system_config WHERE key=?', (key,)).fetchone()
    if existing:
        conn.execute('UPDATE system_config SET value=?, update_time=?, updated_by=? WHERE key=?',
                     (value, time.time(), updated_by, key))
    else:
        conn.execute('INSERT INTO system_config (key, value, description, update_time, updated_by) VALUES (?,?,?,?,?)',
                     (key, value, '', time.time(), updated_by))
    conn.commit()
    conn.close()


# ========== 数据源管理 ==========

def list_data_sources():
    conn = _get_conn()
    rows = conn.execute('SELECT * FROM data_sources ORDER BY priority, id').fetchall()
    conn.close()
    return [dict(r) for r in rows]


def add_data_source(name, typ, url, priority=1, timeout=10, interval=0, remark=''):
    conn = _get_conn()
    conn.execute('INSERT INTO data_sources (name, type, url, priority, timeout, interval, status, remark, create_time) VALUES (?,?,?,?,?,?,?,?,?)',
                 (name, typ, url, priority, timeout, interval, 1, remark, time.time()))
    conn.commit()
    conn.close()


def update_data_source(ds_id, **kwargs):
    conn = _get_conn()
    sets = []
    vals = []
    for k in ('name', 'type', 'url', 'priority', 'timeout', 'interval', 'status', 'remark'):
        if k in kwargs:
            sets.append(f'{k}=?')
            vals.append(kwargs[k])
    if not sets:
        conn.close()
        return False
    sets.append('update_time=?')
    vals.append(time.time())
    vals.append(ds_id)
    conn.execute(f'UPDATE data_sources SET {",".join(sets)} WHERE id=?', vals)
    conn.commit()
    conn.close()
    return True


def delete_data_source(ds_id):
    conn = _get_conn()
    conn.execute('DELETE FROM data_sources WHERE id=?', (ds_id,))
    conn.commit()
    conn.close()


# ========== 采集任务 ==========

def list_collection_tasks():
    conn = _get_conn()
    rows = conn.execute('SELECT * FROM collection_tasks ORDER BY id').fetchall()
    conn.close()
    return [dict(r) for r in rows]


def update_collection_task(task_id, **kwargs):
    conn = _get_conn()
    sets = []
    vals = []
    for k in ('name', 'description', 'cron', 'config', 'status'):
        if k in kwargs:
            sets.append(f'{k}=?')
            vals.append(kwargs[k])
    if not sets:
        conn.close()
        return False
    sets.append('update_time=?')
    vals.append(time.time())
    vals.append(task_id)
    conn.execute(f'UPDATE collection_tasks SET {",".join(sets)} WHERE id=?', vals)
    conn.commit()
    conn.close()
    return True


def toggle_collection_task(task_id, enabled):
    conn = _get_conn()
    conn.execute('UPDATE collection_tasks SET status=?, update_time=? WHERE id=?',
                 (1 if enabled else 0, time.time(), task_id))
    conn.commit()
    conn.close()


def record_collection_run(task_id, task_name, task_code, status, start_time, records=0, detail='', error=''):
    conn = _get_conn()
    end_time = time.time()
    duration = end_time - start_time
    conn.execute('''INSERT INTO collection_logs (task_id, task_name, task_code, status, start_time, end_time, duration, records, detail, error)
                    VALUES (?,?,?,?,?,?,?,?,?,?)''',
                 (task_id, task_name, task_code, status, start_time, end_time, duration, records, detail, error))
    # 更新任务状态
    conn.execute('''UPDATE collection_tasks SET last_run_time=?, last_run_status=?, last_run_duration=?, last_records=?, update_time=?
                    WHERE id=?''', (end_time, status, duration, records, end_time, task_id))
    conn.commit()
    conn.close()


def list_collection_logs(page=1, size=20, task_id=None):
    conn = _get_conn()
    offset = (page - 1) * size
    if task_id:
        total = conn.execute('SELECT COUNT(*) FROM collection_logs WHERE task_id=?', (task_id,)).fetchone()[0]
        rows = conn.execute('SELECT * FROM collection_logs WHERE task_id=? ORDER BY id DESC LIMIT ? OFFSET ?', (task_id, size, offset)).fetchall()
    else:
        total = conn.execute('SELECT COUNT(*) FROM collection_logs').fetchone()[0]
        rows = conn.execute('SELECT * FROM collection_logs ORDER BY id DESC LIMIT ? OFFSET ?', (size, offset)).fetchall()
    conn.close()
    return [dict(r) for r in rows], total


# ========== 基金缓存 ==========

def upsert_fund_cache(code, name='', type='', company='', manager='', status='normal',
                      net_value=0, total_net_value=0, net_value_date='', change=0):
    conn = _get_conn()
    conn.execute('''INSERT INTO fund_cache (code, name, type, company, manager, status, net_value, total_net_value, net_value_date, change, update_time)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(code) DO UPDATE SET name=excluded.name, type=excluded.type, company=excluded.company,
                    manager=excluded.manager, status=excluded.status, net_value=excluded.net_value,
                    total_net_value=excluded.total_net_value, net_value_date=excluded.net_value_date,
                    change=excluded.change, update_time=excluded.update_time''',
                 (code, name, type, company, manager, status, net_value, total_net_value, net_value_date, change, time.time()))
    conn.commit()
    conn.close()


def list_fund_cache(page=1, size=20, keyword='', status=None):
    conn = _get_conn()
    offset = (page - 1) * size
    where = []
    vals = []
    if keyword:
        where.append('(code LIKE ? OR name LIKE ?)')
        vals.extend([f'%{keyword}%', f'%{keyword}%'])
    if status:
        where.append('status=?')
        vals.append(status)
    where_clause = ' WHERE ' + ' AND '.join(where) if where else ''
    total = conn.execute(f'SELECT COUNT(*) FROM fund_cache{where_clause}', vals).fetchone()[0]
    rows = conn.execute(f'SELECT * FROM fund_cache{where_clause} ORDER BY update_time DESC LIMIT ? OFFSET ?',
                        vals + [size, offset]).fetchall()
    conn.close()
    return [dict(r) for r in rows], total


def get_fund_cache_count():
    conn = _get_conn()
    total = conn.execute('SELECT COUNT(*) FROM fund_cache').fetchone()[0]
    conn.close()
    return total


# ========== 仪表盘统计 ==========

def get_dashboard_stats():
    """获取仪表盘统计数据"""
    conn = _get_conn()
    now = time.time()
    today_start = now - (now % 86400) - 8 * 3600  # UTC+8 当天0点

    # 管理员数
    admin_count = conn.execute('SELECT COUNT(*) FROM admins WHERE status=1').fetchone()[0]
    # 搜索统计
    search_today = conn.execute('SELECT COUNT(*) FROM search_logs WHERE create_time>=?', (today_start,)).fetchone()[0]
    search_total = conn.execute('SELECT COUNT(*) FROM search_logs').fetchone()[0]
    search_invalid = conn.execute('SELECT COUNT(*) FROM search_logs WHERE result_count=0').fetchone()[0]
    # 登录日志
    login_today = conn.execute('SELECT COUNT(*) FROM admin_login_logs WHERE create_time>=?', (today_start,)).fetchone()[0]
    login_fail = conn.execute("SELECT COUNT(*) FROM admin_login_logs WHERE status='fail' AND create_time>=?", (today_start,)).fetchone()[0]
    # 操作日志
    op_today = conn.execute('SELECT COUNT(*) FROM admin_operation_logs WHERE create_time>=?', (today_start,)).fetchone()[0]
    # 基金缓存数
    fund_cached = conn.execute('SELECT COUNT(*) FROM fund_cache').fetchone()[0]
    # 采集任务
    task_active = conn.execute('SELECT COUNT(*) FROM collection_tasks WHERE status=1').fetchone()[0]
    task_total = conn.execute('SELECT COUNT(*) FROM collection_tasks').fetchone()[0]
    # 采集日志今日
    coll_today = conn.execute('SELECT COUNT(*) FROM collection_logs WHERE start_time>=?', (today_start,)).fetchone()[0]
    coll_fail = conn.execute("SELECT COUNT(*) FROM collection_logs WHERE status='fail' AND start_time>=?", (today_start,)).fetchone()[0]
    # 数据源
    ds_active = conn.execute('SELECT COUNT(*) FROM data_sources WHERE status=1').fetchone()[0]
    ds_total = conn.execute('SELECT COUNT(*) FROM data_sources').fetchone()[0]

    # 最近7天搜索趋势
    trend = []
    for i in range(6, -1, -1):
        day_start = today_start - i * 86400
        day_end = day_start + 86400
        cnt = conn.execute('SELECT COUNT(*) FROM search_logs WHERE create_time>=? AND create_time<?', (day_start, day_end)).fetchone()[0]
        trend.append({'date': datetime.fromtimestamp(day_start).strftime('%m-%d'), 'count': cnt})

    conn.close()
    return {
        'admin_count': admin_count,
        'search_today': search_today,
        'search_total': search_total,
        'search_invalid': search_invalid,
        'login_today': login_today,
        'login_fail': login_fail,
        'op_today': op_today,
        'fund_cached': fund_cached,
        'task_active': task_active,
        'task_total': task_total,
        'coll_today': coll_today,
        'coll_fail': coll_fail,
        'ds_active': ds_active,
        'ds_total': ds_total,
        'search_trend': trend,
        'system_uptime': now - _get_boot_time(),
    }


_boot_time = time.time()
def _get_boot_time():
    return _boot_time


# ========== 公告管理 ==========

def list_announcements(active_only=False):
    """获取公告列表，active_only=True 只返回有效公告"""
    conn = _get_conn()
    if active_only:
        now = time.time()
        rows = conn.execute(
            '''SELECT * FROM announcements WHERE status=1
               AND (start_time IS NULL OR start_time<=?)
               AND (end_time IS NULL OR end_time>=?)
               ORDER BY sort_order, id DESC''', (now, now)
        ).fetchall()
    else:
        rows = conn.execute('SELECT * FROM announcements ORDER BY sort_order, id DESC').fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_announcement(ann_id):
    conn = _get_conn()
    row = conn.execute('SELECT * FROM announcements WHERE id=?', (ann_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def create_announcement(title, content, type='info', link='', sort_order=0, status=1, start_time=None, end_time=None):
    conn = _get_conn()
    c = conn.execute(
        '''INSERT INTO announcements (title, content, type, link, sort_order, status, start_time, end_time, create_time)
           VALUES (?,?,?,?,?,?,?,?,?)''',
        (title, content, type, link, sort_order, status, start_time, end_time, time.time())
    )
    conn.commit()
    ann_id = c.lastrowid
    conn.close()
    return ann_id


def update_announcement(ann_id, **kwargs):
    conn = _get_conn()
    sets = []
    vals = []
    for k in ('title', 'content', 'type', 'link', 'sort_order', 'status', 'start_time', 'end_time'):
        if k in kwargs:
            sets.append(f'{k}=?')
            vals.append(kwargs[k])
    if not sets:
        conn.close()
        return False
    sets.append('update_time=?')
    vals.append(time.time())
    vals.append(ann_id)
    conn.execute(f'UPDATE announcements SET {",".join(sets)} WHERE id=?', vals)
    conn.commit()
    conn.close()
    return True


def delete_announcement(ann_id):
    conn = _get_conn()
    conn.execute('DELETE FROM announcements WHERE id=?', (ann_id,))
    conn.commit()
    conn.close()


# 初始化（模块导入时执行）
try:
    init_db()
except Exception as e:
    print(f'[AdminDB] 初始化失败: {e}', flush=True)
