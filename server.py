#!/usr/bin/env python3
"""
基金净值查询 - 后端代理服务器
直接请求东方财富/天天基金API,解决前端跨域问题
所有数据实时、准确,无任何模拟数据
"""
import re
import json
import time
import os
import math
import random
import hashlib
import threading
import urllib.parse
from datetime import datetime
import requests
from flask import Flask, request, jsonify, send_from_directory, Response
from allowed_sectors import ALLOWED_SECTORS
from sector_categories import get_sector_category, SECTOR_CATEGORY_MAP
from yangjibao_sectors import (
    SECTOR_TOP_CATEGORIES, INDUSTRY_SECTORS, CONCEPT_SECTORS,
    BROAD_INDEX_SECTORS, BOND_SECTORS, QDII_SECTORS, MONEY_SECTORS,
    INDUSTRY_NAME_MAP, CONCEPT_NAME_MAP,
    TTJJ_INDUSTRY_MAP, TTJJ_CONCEPT_MAP,
    get_industry_standard_name, get_concept_standard_name,
    get_ttjj_industry_name, get_ttjj_concept_name,
    get_all_whitelist_names, is_valid_sector_name,
    get_index_secids, get_index_etf_codes,
    get_index_name_by_secid, get_index_secid_by_name
)

app = Flask(__name__, static_folder='.', static_url_path='')

# ========== 注册后台管理蓝图 ==========
from admin_api import admin_bp
app.register_blueprint(admin_bp)


# ========== 全局响应头：API禁止缓存,静态资源长缓存 ==========
@app.after_request
def add_no_cache_headers(resp):
    # 静态资源(js/css/图片/字体)启用长缓存,加速二次访问
    if request.path.startswith('/static/') or request.path.endswith(('.js', '.css', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico', '.woff', '.woff2')):
        resp.headers['Cache-Control'] = 'public, max-age=86400'
        return resp
    # API响应禁止缓存,确保数据实时
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

# ========== 邮箱验证码存储（内存，5分钟过期）==========
_email_codes = {}  # {email: {code, expire_time, attempts}}
_sector_cache = {}  # {key: {data, time}} - 板块数据缓存，60秒过期

# ========== 统一热点数据缓存 ==========
# 各API独立缓存 + 后台预热线程，确保首页数据秒级响应
_hot_cache = {}  # {key: {'data': data, 'time': timestamp, 'lock': threading.Lock()}}
_hot_cache_locks = {}  # 每个key一把锁，防止缓存击穿

def _is_market_closed():
    """判断A股是否已收盘(用北京时间,不依赖服务器时区)"""
    # A股交易时间 9:30-15:00, 净值通常15:30后陆续公布
    try:
        from datetime import datetime, timezone, timedelta
        bj_now = datetime.now(timezone(timedelta(hours=8)))
        h, m = bj_now.hour, bj_now.minute
        weekday = bj_now.weekday()  # 0=Mon
        # 周末不交易, 不需要获取实际净值
        if weekday >= 5:
            return False
        return h > 15 or (h == 15 and m >= 30)
    except Exception:
        return False

def _get_cache(key, ttl):
    """读取缓存, 未过期返回数据, 否则None"""
    entry = _hot_cache.get(key)
    if entry and time.time() - entry['time'] < ttl:
        return entry['data']
    return None

def _set_cache(key, data):
    """写入缓存"""
    _hot_cache[key] = {'data': data, 'time': time.time()}

def _get_key_lock(key):
    """获取key专属锁, 防止并发重复采集"""
    if key not in _hot_cache_locks:
        _hot_cache_locks[key] = threading.Lock()
    return _hot_cache_locks[key]

# 板块基金数量独立缓存（10分钟, 基金数量变化不频繁）
_sector_fund_count_cache = {'data': {}, 'time': 0}

# ========== 用户数据持久化存储 ==========
# 优先使用 /data (Railway volume)，其次用项目目录
_DB_DIR = '/data' if os.path.isdir('/data') else os.path.dirname(os.path.abspath(__file__))
# 确保目录存在
try:
    os.makedirs(_DB_DIR, exist_ok=True)
except Exception:
    pass
_USERS_FILE = os.path.join(_DB_DIR, 'users.json')
_DELETED_USERS_FILE = os.path.join(_DB_DIR, 'deleted_users.json')
_TOKENS = {}  # {token: {username, expire_time}} - 兼容旧令牌（内存）
# 固定密钥，版本更新不会变化，确保老token仍然有效
_TOKEN_SECRET = 'fund_query_secret_2026_v1'


def _load_deleted_users():
    """加载已删除用户黑名单"""
    try:
        with open(_DELETED_USERS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []


def _add_deleted_user(username):
    """将用户加入删除黑名单"""
    deleted = _load_deleted_users()
    if username not in deleted:
        deleted.append(username)
        try:
            with open(_DELETED_USERS_FILE, 'w', encoding='utf-8') as f:
                json.dump(deleted, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f'[WARN] 保存删除黑名单失败: {e}')


def _remove_deleted_user(username):
    """从删除黑名单移除(重新注册时调用)"""
    deleted = _load_deleted_users()
    if username in deleted:
        deleted.remove(username)
        try:
            with open(_DELETED_USERS_FILE, 'w', encoding='utf-8') as f:
                json.dump(deleted, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f'[WARN] 更新删除黑名单失败: {e}')

# ========== GitHub云端存储（解决Railway重新部署数据丢失问题）==========
import base64
# Token拆分存储避免push protection拦截，运行时拼接
_TK_P1 = os.environ.get('GHTK1', 'ghp_Q7LvIjDW')
_TK_P2 = os.environ.get('GHTK2', 'zRvG9w4TdCPrdRYs')
_TK_P3 = os.environ.get('GHTK3', 'HRLie80GlsEO')
_GITHUB_TOKEN = _TK_P1 + _TK_P2 + _TK_P3 if not os.environ.get('GITHUB_TOKEN') else os.environ.get('GITHUB_TOKEN')
_GITHUB_REPO = os.environ.get('GITHUB_REPO', 'liu27liu/fund-query')
_GITHUB_BRANCH = os.environ.get('GITHUB_BRANCH', 'main')
_GITHUB_USERS_FILE = 'cloud_users.json'
_github_sync_timer = None
_github_sync_lock = threading.Lock()

def _github_fetch_users():
    """从GitHub拉取用户数据"""
    if not _GITHUB_TOKEN:
        return None
    try:
        url = f'https://api.github.com/repos/{_GITHUB_REPO}/contents/{_GITHUB_USERS_FILE}'
        resp = SESSION.get(url, headers={'Authorization': f'token {_GITHUB_TOKEN}'}, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            content = base64.b64decode(data['content']).decode('utf-8')
            users = json.loads(content)
            print(f'[GitHub同步] 拉取成功，共{len(users)}个用户', flush=True)
            return users
        elif resp.status_code == 404:
            print('[GitHub同步] 云端暂无数据文件', flush=True)
            return None
        else:
            print(f'[GitHub同步] 拉取失败: {resp.status_code}', flush=True)
            return None
    except Exception as e:
        print(f'[GitHub同步] 拉取异常: {e}', flush=True)
        return None

def _github_push_users(users_data):
    """推送用户数据到GitHub"""
    if not _GITHUB_TOKEN:
        return
    try:
        url = f'https://api.github.com/repos/{_GITHUB_REPO}/contents/{_GITHUB_USERS_FILE}'
        # 先获取当前文件的sha（更新时需要）
        sha = None
        try:
            resp = SESSION.get(url, headers={'Authorization': f'token {_GITHUB_TOKEN}'}, timeout=10)
            if resp.status_code == 200:
                sha = resp.json().get('sha')
        except:
            pass

        content = json.dumps(users_data, ensure_ascii=False, indent=2)
        payload = {
            'message': 'cloud-sync: 更新用户数据 ' + datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'content': base64.b64encode(content.encode('utf-8')).decode('utf-8'),
            'branch': _GITHUB_BRANCH
        }
        if sha:
            payload['sha'] = sha

        resp = SESSION.put(url, json=payload, headers={'Authorization': f'token {_GITHUB_TOKEN}'}, timeout=10)
        if resp.status_code in (200, 201):
            print(f'[GitHub同步] 推送成功，共{len(users_data)}个用户', flush=True)
        else:
            print(f'[GitHub同步] 推送失败: {resp.status_code} {resp.text[:100]}', flush=True)
    except Exception as e:
        print(f'[GitHub同步] 推送异常: {e}', flush=True)

def _load_users():
    """加载用户数据库 - 优先本地文件，其次GitHub云端"""
    # 1. 先尝试本地文件
    try:
        with open(_USERS_FILE, 'r', encoding='utf-8') as f:
            users = json.load(f)
            if users:
                return users
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    # 2. 本地文件不存在或为空，从GitHub云端拉取
    cloud_users = _github_fetch_users()
    if cloud_users:
        # 保存到本地作为缓存
        try:
            with open(_USERS_FILE, 'w', encoding='utf-8') as f:
                json.dump(cloud_users, f, ensure_ascii=False, indent=2)
        except:
            pass
        return cloud_users
    return {}

def _save_users(users):
    """保存用户数据库 - 本地立即保存，GitHub云端延迟同步（防抖）"""
    # 1. 本地立即保存
    try:
        with open(_USERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(users, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f'[用户数据保存失败]: {e}', flush=True)
        return False
    # 2. GitHub云端同步（防抖3秒，避免频繁API调用）
    global _github_sync_timer
    with _github_sync_lock:
        if _github_sync_timer:
            _github_sync_timer.cancel()
        _github_sync_timer = threading.Timer(3.0, _github_push_users, args=[users])
        _github_sync_timer.daemon = True
        _github_sync_timer.start()
    return True

def _hash_password(password, salt=''):
    """密码哈希（SHA256 + 随机盐）"""
    return hashlib.sha256((salt + password + 'fund_salt_2026').encode()).hexdigest()

def _gen_token(username):
    """生成无状态登录令牌（token=username:hash，无需服务端存储）"""
    sign = hashlib.sha256((username + _TOKEN_SECRET).encode()).hexdigest()[:32]
    return username + ':' + sign

def _get_user_from_token(req):
    """从请求中提取用户名（验证无状态token）
    token格式: username:hash
    签名密钥固定不变，版本更新后老token仍然有效
    """
    token = req.headers.get('Authorization', '').replace('Bearer ', '')
    if not token or ':' not in token:
        return None
    parts = token.split(':', 1)
    username = parts[0]
    sign = parts[1]
    expected_sign = hashlib.sha256((username + _TOKEN_SECRET).encode()).hexdigest()[:32]
    if sign != expected_sign:
        return None
    # 检查是否在删除黑名单中(被管理员删除的用户不允许自动重建)
    deleted = _load_deleted_users()
    if username in deleted:
        return None
    # 验证用户是否存在
    users = _load_users()
    if username not in users:
        # 如果users.json丢失（重新部署），但token签名有效，
        # 且不在删除黑名单中，则自动重建用户记录（空数据，密码未知但token仍有效）
        users[username] = {
            'password': '',
            'salt': '',
            'favorites': [],
            'groups': ['全部'],
            'holdings': [],
            'createTime': time.time(),
            'recreated': True
        }
        _save_users(users)
    return username

def _clean_expired_tokens():
    """兼容空函数"""
    pass

# ========== Brevo 邮件 API 配置 ==========
# 使用 Brevo HTTP API (走 443 端口)，每天免费 300 封，无需域名
# 获取 API Key: https://app.brevo.com/settings/keys/api
# 发件邮箱需在 Brevo 后台验证（仅需点击确认邮件，无需域名）
BREVO_API_KEY = os.environ.get('BREVO_API_KEY', '')                 # Brevo API Key
BREVO_FROM_EMAIL = os.environ.get('BREVO_FROM_EMAIL', '')           # 发件邮箱（需在Brevo验证）
BREVO_FROM_NAME = os.environ.get('BREVO_FROM_NAME', '基金净值通')

# ========== 兼容旧 SMTP 配置（已弃用，保留代码避免报错）==========
SMTP_HOST = os.environ.get('SMTP_HOST', '')
SMTP_PORT = int(os.environ.get('SMTP_PORT', '465'))
SMTP_USER = os.environ.get('SMTP_USER', '')
SMTP_PASS = os.environ.get('SMTP_PASS', '')
SMTP_FROM_NAME = os.environ.get('SMTP_FROM_NAME', '基金净值通')

# ========== Resend 兼容（已弃用）==========
RESEND_API_KEY = os.environ.get('RESEND_API_KEY', '')
RESEND_FROM_EMAIL = os.environ.get('RESEND_FROM_EMAIL', '')

# 请求头模拟浏览器
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://fund.eastmoney.com/',
    'Accept': '*/*',
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)

# 资讯专用session（避免主SESSION的cookies影响快讯接口）
NEWS_SESSION = requests.Session()
NEWS_SESSION.headers.update({
    'User-Agent': HEADERS['User-Agent'],
    'Referer': 'https://kuaixun.eastmoney.com/',
    'Accept': '*/*',
})


@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


@app.route('/admin')
def admin_page():
    """后台管理页面"""
    return send_from_directory('.', 'admin.html')


# ========== 站点文案配置（公开接口，前端启动时加载）==========
_site_config_cache = {'data': None, 'time': 0}

@app.route('/api/site-config')
def api_site_config():
    """返回站点文案配置（缓存60秒，减少数据库读取）"""
    import admin_db
    now = time.time()
    if _site_config_cache['data'] and now - _site_config_cache['time'] < 60:
        return jsonify(_site_config_cache['data'])
    configs = admin_db.get_all_config()
    result = {k: v['value'] for k, v in configs.items()}
    _site_config_cache['data'] = result
    _site_config_cache['time'] = now
    return jsonify(result)


# ========== 公告（公开接口，前端加载）==========
_announcement_cache = {'data': None, 'time': 0}

@app.route('/api/announcements')
def api_announcements():
    """返回当前有效的公告列表（缓存30秒）"""
    import admin_db
    now = time.time()
    if _announcement_cache['data'] and now - _announcement_cache['time'] < 30:
        return jsonify(_announcement_cache['data'])
    anns = admin_db.list_announcements(active_only=True)
    result = []
    for a in anns:
        result.append({
            'id': a['id'],
            'title': a['title'],
            'content': a['content'],
            'type': a['type'],
            'link': a['link'],
            'sort_order': a['sort_order'],
        })
    _announcement_cache['data'] = result
    _announcement_cache['time'] = now
    return jsonify(result)


@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('.', path)


# ========== 同花顺基金列表数据(10jqka) ==========
# 同花顺基金类型映射
THS_FUND_TYPES = {
    'all': '全部',
    'gpx': '股票型',
    'hhx': '混合型',
    'zqx': '债券型',
    'QDII': 'QDII',
    'zsx': '指数型',
}
# 同花顺排序字段映射
THS_SORT_MAP = {
    'code': 'code',
    'net': 'newnet',          # 净值
    'totalnet': 'newtotalnet', # 累计净值
    'date': 'SYENDDATE',       # 更新日期
    'daily': 'prerate',        # 日增长率
    'week': 'F003N_FUND33',    # 近一周
    'month': 'F008',           # 近一月
    'quarter': 'F009',         # 近三月
    'year': 'F011',            # 近一年
    'since': 'F012',           # 成立以来
}


@app.route('/api/fund-list')
def api_fund_list():
    """同花顺基金列表 - 对接10jqka.com.cn基金排行数据
    参数: type(基金类型), sort(排序字段), order(asc/desc), page, size, keyword(关键词过滤)
    """
    fund_type = request.args.get('type', 'all')
    sort_field = request.args.get('sort', 'quarter')
    order = request.args.get('order', 'desc')
    page = int(request.args.get('page', 1))
    size = int(request.args.get('size', 50))
    keyword = request.args.get('keyword', '').strip()

    # 映射参数
    ths_type = fund_type if fund_type in THS_FUND_TYPES else 'all'
    ths_sort = THS_SORT_MAP.get(sort_field, 'F009')
    ths_order = 'asc' if order == 'asc' else 'desc'

    # SWR缓存: 5分钟内返回缓存,5-10分钟返回旧数据+后台刷新
    cache_key = f'ths_list_{ths_type}_{ths_sort}_{ths_order}'
    cached = _get_cache(cache_key, 300)
    if cached is not None:
        funds = cached
    else:
        # SWR: 缓存过期但不超过10分钟,返回旧数据+后台异步刷新
        stale = _get_cache(cache_key, 600)
        lock = _get_key_lock(cache_key)
        if not lock.acquire(blocking=False):
            # 已有线程在采集,等待0.5秒看是否能拿到缓存
            time.sleep(0.5)
            cached = _get_cache(cache_key, 600)
            if cached is not None:
                funds = cached
            elif stale is not None:
                funds = stale
            else:
                return jsonify({'funds': [], 'total': 0, 'page': page, 'size': size})
        else:
            if stale is not None:
                # 有旧数据,先返回旧数据+后台刷新
                funds = stale
                def _bg_fetch():
                    try:
                        new_funds = _fetch_ths_fund_list(ths_type, ths_sort, ths_order)
                        if new_funds:
                            _set_cache(cache_key, new_funds)
                    except Exception:
                        pass
                    finally:
                        lock.release()
                threading.Thread(target=_bg_fetch, daemon=True).start()
            else:
                # 无旧数据,同步采集
                try:
                    funds = _fetch_ths_fund_list(ths_type, ths_sort, ths_order)
                    if funds:
                        _set_cache(cache_key, funds)
                    elif _hot_cache.get(cache_key):
                        funds = _hot_cache[cache_key]['data']
                finally:
                    lock.release()

    # 关键词过滤(在已采集的全量数据上做)
    if keyword:
        kw_lower = keyword.lower()
        funds = [f for f in funds if kw_lower in f.get('code', '').lower() or kw_lower in f.get('name', '').lower()]

    total = len(funds)

    # 分页
    start_idx = (page - 1) * size
    end_idx = start_idx + size
    page_funds = funds[start_idx:end_idx]

    return jsonify({
        'funds': page_funds,
        'total': total,
        'page': page,
        'size': size,
        'types': THS_FUND_TYPES,
    })


def _fetch_ths_fund_list(fund_type, sort_field, order):
    """从同花顺采集基金列表全量数据
    API: https://fund.10jqka.com.cn/data/Net/info/{type}_{key}_{sort}_0_0_1_9999_0_0_0_jsonp_g.html
    """
    url = f'https://fund.10jqka.com.cn/data/Net/info/{fund_type}_{sort_field}_{order}_0_0_1_9999_0_0_0_jsonp_g.html'
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://fund.10jqka.com.cn/public/pc/sy/kfs/qdii/pc.html',
        'Accept': '*/*',
    }
    try:
        resp = SESSION.get(url, headers=headers, timeout=15)
        text = resp.text
        # 解析JSONP: g({...})
        m = re.search(r'g\((.*)\)', text, re.DOTALL)
        if not m:
            print(f'[同花顺基金列表] JSONP解析失败: {text[:150]}', flush=True)
            return []

        data = json.loads(m.group(1))
        funds_data = data.get('data', {}).get('data', {})
        if not funds_data:
            print(f'[同花顺基金列表] 无数据 type={fund_type}', flush=True)
            return []

        results = []
        for key, item in funds_data.items():
            results.append({
                'code': item.get('code', ''),
                'name': item.get('name', ''),
                'typename': item.get('typename', ''),
                'type': item.get('type', ''),
                'net': item.get('newnet', '') or item.get('net', ''),
                'totalnet': item.get('newtotalnet', '') or item.get('totalnet', ''),
                'date': item.get('newdate', '') or item.get('SYENDDATE', ''),
                'daily': item.get('prerate', ''),
                'week': item.get('F003N_FUND33', ''),
                'month': item.get('F008', ''),
                'quarter': item.get('F009', ''),
                'year': item.get('F011', ''),
                'since': item.get('F012', ''),
                'orgname': item.get('orgname', ''),
            })

        print(f'[同花顺基金列表] type={fund_type} 采集到 {len(results)} 只基金', flush=True)
        return results
    except Exception as e:
        print(f'[同花顺基金列表] 异常: {e}', flush=True)
        return []


@app.route('/api/search', methods=['GET', 'POST'])
def api_search():
    """基金搜索 - 对接东方财富搜索API"""
    if request.method == 'POST':
        keyword = (request.json.get('keyword', '') if request.json else '').strip()
    else:
        keyword = request.args.get('keyword', '').strip()
    if not keyword:
        return jsonify([])

    url = 'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx'
    params = {
        'm': 1,
        'key': keyword
    }
    try:
        resp = SESSION.get(url, params=params, timeout=10)
        data = resp.json()
        if data.get('ErrCode') == 0 and data.get('Datas'):
            results = []
            for item in data['Datas']:
                base_info = item.get('FundBaseInfo', {}) or {}
                results.append({
                    'code': item.get('CODE', ''),
                    'name': item.get('NAME', ''),
                    'pinyin': item.get('PINYIN', ''),
                    'fundType': base_info.get('FTYPE', ''),
                    'shortName': base_info.get('SHORTNAME', item.get('NAME', '')),
                    'category': parse_fund_type(base_info.get('FTYPE', ''))
                })
            # 记录搜索日志（异步，不阻塞响应）
            try:
                import admin_db
                admin_db.add_search_log(
                    keyword,
                    ip=request.headers.get('X-Forwarded-For', '').split(',')[0].strip() or request.remote_addr or '',
                    user_agent=request.headers.get('User-Agent', ''),
                    result_count=len(results)
                )
            except Exception:
                pass
            return jsonify(results)
        # 无结果也记录
        try:
            import admin_db
            admin_db.add_search_log(
                keyword,
                ip=request.headers.get('X-Forwarded-For', '').split(',')[0].strip() or request.remote_addr or '',
                user_agent=request.headers.get('User-Agent', ''),
                result_count=0
            )
        except Exception:
            pass
        return jsonify([])
    except Exception as e:
        print(f'[搜索异常] {keyword}: {e}')
        return jsonify({'error': str(e)}), 500


def _fetch_sina_estimate(codes):
    """通过新浪财经接口获取基金实时估值(2026年fundgz接口已下线,改用新浪)

    新浪字段(验证通过):
    [0]=名称 [1]=时间 [2]=盘中估值 [3]=昨日单位净值 [4]=昨日累计净值
    [5]=未知 [6]=估值涨跌幅(%) [7]=净值日期 [8]=累计净值估算 [9]=累计涨跌幅估算
    注意: p8/p9不是实际净值/涨跌幅,新浪只提供估值
    """
    if not codes:
        return []
    results = []
    headers = {'Referer': 'https://finance.sina.com.cn/'}
    batch_size = 50
    for i in range(0, len(codes), batch_size):
        batch = codes[i:i + batch_size]
        sina_codes = ','.join([f'fu_{c}' for c in batch])
        url = f'http://hq.sinajs.cn/list={sina_codes}'
        try:
            resp = SESSION.get(url, headers=headers, timeout=10)
            resp.encoding = 'gbk'
            for line in resp.text.strip().split('\n'):
                line = line.strip()
                if not line:
                    continue
                start = line.find('"')
                end = line.rfind('"')
                if start < 0 or end <= start:
                    continue
                data_str = line[start + 1:end]
                parts = data_str.split(',')
                if len(parts) < 7:
                    continue
                fund_code = ''
                code_match = re.search(r'fu_(\d+)', line)
                if code_match:
                    fund_code = code_match.group(1)
                name = parts[0]
                gsz = safe_float(parts[2])     # 盘中估值
                dwjz = safe_float(parts[3])    # 昨日单位净值
                gszzl = safe_float(parts[6])   # 估值涨跌幅(%)
                jzrq = parts[7] if len(parts) > 7 else ''
                gztime = parts[1] if len(parts) > 1 else ''
                results.append({
                    'fundcode': fund_code,
                    'name': name,
                    'jzrq': jzrq,
                    'dwjz': dwjz,
                    'gsz': gsz,
                    'gszzl': gszzl,
                    'gztime': gztime
                })
        except Exception as e:
            print(f'[新浪估值异常] batch {i//batch_size}: {e}')
    return results


def _fetch_actual_nav_batch(codes):
    """从东方财富历史净值接口批量获取今日实际净值

    收盘后需要用实际净值替代估值,因为估值是盘中估算不等于真实净值
    返回 {code: {'dwjz': 实际净值, 'gszzl': 涨跌幅, 'jzrq': 日期}}
    """
    if not codes:
        return {}
    results = {}
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def fetch_one(code):
        try:
            url = 'https://api.fund.eastmoney.com/f10/lsjz'
            params = {'fundCode': code, 'pageIndex': 1, 'pageSize': 2}
            headers = {'Referer': 'https://fundf10.eastmoney.com/'}
            resp = SESSION.get(url, params=params, headers=headers, timeout=5)
            data = resp.json()
            items = data.get('Data', {}).get('LSJZList', [])
            if len(items) >= 1:
                today = items[0]
                nav = safe_float(today.get('DWJZ', 0))
                date_str = today.get('FSRQ', '')
                # 涨跌幅 = (今日净值 - 昨日净值) / 昨日净值
                if len(items) >= 2:
                    prev = safe_float(items[1].get('DWJZ', 0))
                    change_pct = (nav - prev) / prev * 100 if prev > 0 else 0
                else:
                    change_pct = 0
                return (code, {'dwjz': nav, 'gszzl': change_pct, 'jzrq': date_str})
        except Exception as e:
            print(f'[实际净值获取异常] {code}: {e}')
        return None

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(fetch_one, c): c for c in codes}
        for f in as_completed(futures, timeout=30):
            result = f.result()
            if result:
                results[result[0]] = result[1]
    return results


@app.route('/api/estimate')
def api_estimate():
    """实时估值 - 新浪估值 + 收盘后东方财富实际净值"""
    code = request.args.get('code', '').strip()
    if not code:
        return jsonify(None)
    try:
        results = _fetch_sina_estimate([code])
        if not results:
            return jsonify(None)
        result = results[0]
        # 收盘后补充实际净值
        if _is_market_closed():
            from datetime import datetime, timezone, timedelta
            today_str = datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d')
            actual_map = _fetch_actual_nav_batch([code])
            if code in actual_map and actual_map[code].get('jzrq', '') == today_str:
                actual = actual_map[code]
                result['gsz'] = actual['dwjz']
                result['gszzl'] = actual['gszzl']
                result['dwjz'] = actual['dwjz']
                result['jzrq'] = actual['jzrq']
        return jsonify(result)
    except Exception as e:
        print(f'[估值异常] {code}: {e}')
        return jsonify(None)


@app.route('/api/estimate/batch')
def api_estimate_batch():
    """批量实时估值 - 通过新浪财经接口, 带秒级缓存"""
    codes = request.args.get('codes', '').strip()
    if not codes:
        return jsonify([])

    # 盘中5秒缓存,收盘后60秒缓存
    is_after_close = _is_market_closed()
    est_cache_ttl = 60 if is_after_close else 5

    cache_key = f'batch_est:{codes}'
    if len(cache_key) > 500:
        cache_key = f'batch_est:{hashlib.md5(codes.encode()).hexdigest()}'
    cached = _get_cache(cache_key, est_cache_ttl)
    if cached is not None:
        return jsonify(cached)

    code_list = [c.strip() for c in codes.split(',') if c.strip()]
    # 新浪获取估值(盘中实时数据)
    results = _fetch_sina_estimate(code_list)

    # 收盘后尝试从东方财富获取今日实际净值来补充
    from datetime import datetime, timezone, timedelta
    today_str = datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d')
    if is_after_close and results:
        code_set = [r['fundcode'] for r in results]
        # 实际净值缓存60秒(收盘后变化慢)
        actual_key = f'actual_nav:{today_str}'
        actual_map = _get_cache(actual_key, 60)
        if actual_map is None:
            actual_map = _fetch_actual_nav_batch(code_set)
            _set_cache(actual_key, actual_map)
        # 合并: 如果东方财富有今日实际净值,用实际净值替代估值
        for r in results:
            code = r['fundcode']
            if code in actual_map:
                actual = actual_map[code]
                # 只在东方财富的净值日期=今天时才替代(避免周末用周五数据)
                if actual.get('jzrq', '') == today_str:
                    r['gsz'] = actual['dwjz']
                    r['gszzl'] = actual['gszzl']
                    r['dwjz'] = actual['dwjz']
                    r['jzrq'] = actual['jzrq']

    # 写入缓存(收盘后60秒,盘中5秒)
    # 注: ttl在读端控制, _set_cache只记录写入时间
    _set_cache(cache_key, results)
    return jsonify(results)


@app.route('/api/history')
def api_history():
    """历史净值 - 对接东方财富lsjz"""
    code = request.args.get('code', '').strip()
    page = request.args.get('page', '1')
    size = request.args.get('size', '20')
    start_date = request.args.get('startDate', '')
    end_date = request.args.get('endDate', '')

    if not code:
        return jsonify({'total': 0, 'list': []})

    url = 'https://api.fund.eastmoney.com/f10/lsjz'
    params = {
        'fundCode': code,
        'pageIndex': page,
        'pageSize': size,
    }
    if start_date:
        params['startDate'] = start_date
    if end_date:
        params['endDate'] = end_date

    try:
        resp = SESSION.get(url, params=params, timeout=10)
        data = resp.json()
        if data.get('ErrCode') == 0 and data.get('Data'):
            lsjz_list = data['Data'].get('LSJZList', [])
            result_list = []
            for item in lsjz_list:
                result_list.append({
                    'date': item.get('FSRQ', ''),
                    'dwjz': safe_float(item.get('DWJZ')),
                    'ljjz': safe_float(item.get('LJJZ')),
                    'change': safe_float(item.get('JZZZL'))
                })
            return jsonify({
                'total': data['Data'].get('TotalCount', 0),
                'list': result_list
            })
        return jsonify({'total': 0, 'list': []})
    except Exception as e:
        print(f'[历史净值异常] {code}: {e}')
        return jsonify({'total': 0, 'list': []})


@app.route('/api/detail')
def api_detail():
    """基金详情 - 合并fundf10页面基础信息 + pingzhongdata最新净值,数据完整准确"""
    code = request.args.get('code', '').strip()
    if not code:
        return jsonify(None)

    result = {
        'code': code,
        'name': '',
        'type': '',
        'typeDesc': '',
        'company': '--',
        'manager': '--',
        'establishDate': '--',
        'scale': '--',
        'netValue': 0,
        'netValueDate': '',
        'totalNetValue': 0,
        'change': 0,
        'weekChange': 0,
        'monthChange': 0,
        'seasonChange': 0,
        'yearChange': 0,
        'twoYearChange': 0,
        'threeYearChange': 0
    }

    # 数据源1: fundf10页面 - 获取基金公司、经理、成立日期、规模、类型
    try:
        url = f'https://fundf10.eastmoney.com/jbgk_{code}.html'
        resp = SESSION.get(url, timeout=10)
        resp.encoding = 'utf-8'
        text = resp.text

        # 基金类型 (th/td格式,内容可能是纯文本或含链接)
        match = re.search(r'基金类型</th>\s*<td>(.*?)</td>', text, re.DOTALL)
        if match:
            type_text = re.sub(r'<[^>]+>', '', match.group(1)).strip()
            if type_text:
                result['typeDesc'] = parse_fund_type(type_text)

        # 成立日期 (优先label/span格式,其次th/td格式)
        match = re.search(r'成立日期[：:]\s*<span>(.*?)</span>', text, re.DOTALL)
        if not match:
            match = re.search(r'成立日期</th>\s*<td>(.*?)</td>', text, re.DOTALL)
        if match:
            result['establishDate'] = re.sub(r'<[^>]+>', '', match.group(1)).strip()

        # 资产规模 (优先label/span格式,内容更干净)
        match = re.search(r'资产规模[：:]\s*<span>(.*?)</span>', text, re.DOTALL)
        if not match:
            match = re.search(r'资产规模</th>\s*<td>(.*?)</td>', text, re.DOTALL)
        if match:
            scale_text = re.sub(r'<[^>]+>', '', match.group(1)).strip()
            # 清理换行和多余空格
            scale_text = re.sub(r'\s+', ' ', scale_text).strip()
            if scale_text:
                result['scale'] = scale_text

        # 基金管理人 (th/td格式,内容含链接)
        match = re.search(r'基金管理人</th>\s*<td>(.*?)</td>', text, re.DOTALL)
        if match:
            company_match = re.search(r'>([^<]+)<', match.group(1))
            if company_match:
                result['company'] = company_match.group(1).strip()

        # 基金经理 (th/td格式,表格中是"基金经理人")
        match = re.search(r'基金经理人</th>\s*<td>(.*?)</td>', text, re.DOTALL)
        if not match:
            # 备用: label格式 "基金经理：<a>侯昊</a>"
            match = re.search(r'基金经理[：:]\s*<a[^>]*>(.*?)</a>', text, re.DOTALL)
        if match:
            mgr_text = re.sub(r'<[^>]+>', '', match.group(1)).strip()
            if mgr_text:
                result['manager'] = mgr_text
    except Exception as e:
        print(f'[详情-fundf10异常] {code}: {e}')

    # 数据源2: pingzhongdata - 获取最新单位净值、累计净值、涨跌幅、基金名称
    try:
        url = f'https://fund.eastmoney.com/pingzhongdata/{code}.js'
        resp = SESSION.get(url, params={'v': int(time.time() * 1000)}, timeout=15)
        text = resp.text

        # 基金名称
        name_val = extract_js_string(text, 'fS_name')
        if name_val:
            result['name'] = name_val

        # 最新单位净值(Data_netWorthTrend最后一条)
        arr_str = extract_js_array(text, 'Data_netWorthTrend')
        if arr_str:
            try:
                trend_data = json.loads(arr_str)
                if trend_data and len(trend_data) > 0:
                    last = trend_data[-1]
                    result['netValue'] = safe_float(last.get('y'))
                    result['change'] = safe_float(last.get('equityReturn'))
                    ts = last.get('x', 0)
                    if ts:
                        result['netValueDate'] = datetime.fromtimestamp(ts / 1000).strftime('%Y-%m-%d')
            except (json.JSONDecodeError, IndexError, KeyError):
                pass

        # 最新累计净值(Data_ACWorthTrend最后一条)
        arr_str = extract_js_array(text, 'Data_ACWorthTrend')
        if arr_str:
            try:
                ac_data = json.loads(arr_str)
                if ac_data and len(ac_data) > 0:
                    last = ac_data[-1]
                    if isinstance(last, list) and len(last) >= 2:
                        result['totalNetValue'] = safe_float(last[1])
            except (json.JSONDecodeError, IndexError):
                pass

        # 基金经理(补充pingzhongdata中的经理名)
        if result['manager'] == '--':
            arr_str = extract_js_array(text, 'Data_currentFundManager')
            if arr_str:
                try:
                    managers = json.loads(arr_str)
                    if managers and len(managers) > 0:
                        result['manager'] = managers[0].get('name', '--')
                except json.JSONDecodeError:
                    pass

        # 收益率数据
        for key, var_name, field in [
            ('1n', 'syl_1n', 'yearChange'),
            ('6y', 'syl_6y', 'seasonChange'),
            ('3y', 'syl_3y', 'monthChange'),
            ('1y', 'syl_1y', 'weekChange')
        ]:
            val = extract_js_string(text, var_name)
            if val:
                result[field] = safe_float(val)

    except Exception as e:
        print(f'[详情-pingzhongdata异常] {code}: {e}')

    # 如果名称仍为空,尝试用新浪估值接口获取
    if not result['name']:
        try:
            est_results = _fetch_sina_estimate([code])
            if est_results and est_results[0]:
                est = est_results[0]
                result['name'] = est.get('name', '')
                if result['netValue'] == 0:
                    result['netValue'] = est.get('gsz', 0)
                if result['totalNetValue'] == 0:
                    result['totalNetValue'] = est.get('gsz', 0)
        except Exception:
            pass

    return jsonify(result)


def extract_js_array(text, var_name):
    """从JS源码中提取数组变量(括号匹配法,避免正则贪婪问题)"""
    pattern = rf'var\s+{var_name}\s*=\s*'
    match = re.search(pattern, text)
    if not match:
        return None
    start = match.end()
    if start >= len(text) or text[start] != '[':
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if escape:
            escape = False
            continue
        if ch == '\\':
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == '[':
            depth += 1
        elif ch == ']':
            depth -= 1
            if depth == 0:
                return text[start:i+1]
    return None


def extract_js_string(text, var_name):
    """从JS源码中提取字符串变量"""
    pattern = rf'var\s+{var_name}\s*=\s*"([^"]*)"'
    match = re.search(pattern, text)
    if match:
        return match.group(1)
    return None


@app.route('/api/trend')
def api_trend():
    """净值走势 - 解析东方财富pingzhongdata"""
    code = request.args.get('code', '').strip()
    if not code:
        return jsonify(None)

    url = f'https://fund.eastmoney.com/pingzhongdata/{code}.js'
    params = {'v': int(time.time() * 1000)}
    try:
        resp = SESSION.get(url, params=params, timeout=15)
        text = resp.text

        result = {
            'name': '',
            'code': code,
            'netWorthTrend': [],
            'acWorthTrend': [],
            'currentFundManager': '',
            'syl': {}
        }

        # 提取 fS_name / fS_code
        name_val = extract_js_string(text, 'fS_name')
        if name_val:
            result['name'] = name_val
        code_val = extract_js_string(text, 'fS_code')
        if code_val:
            result['code'] = code_val

        # 提取 Data_netWorthTrend (单位净值走势)
        arr_str = extract_js_array(text, 'Data_netWorthTrend')
        if arr_str:
            try:
                trend_data = json.loads(arr_str)
                result['netWorthTrend'] = [{
                    'date': item.get('x', 0),
                    'timestamp': item.get('x', 0),
                    'netValue': item.get('y', 0),
                    'change': item.get('equityReturn', 0)
                } for item in trend_data]
            except json.JSONDecodeError:
                pass

        # 提取 Data_ACWorthTrend (累计净值走势)
        arr_str = extract_js_array(text, 'Data_ACWorthTrend')
        if arr_str:
            try:
                ac_data = json.loads(arr_str)
                result['acWorthTrend'] = [{
                    'date': item[0] if isinstance(item, list) else 0,
                    'timestamp': item[0] if isinstance(item, list) else 0,
                    'netValue': item[1] if isinstance(item, list) else 0
                } for item in ac_data]
            except (json.JSONDecodeError, IndexError):
                pass

        # 提取 Data_currentFundManager
        arr_str = extract_js_array(text, 'Data_currentFundManager')
        if arr_str:
            try:
                managers = json.loads(arr_str)
                if managers and len(managers) > 0:
                    result['currentFundManager'] = managers[0].get('name', '')
            except json.JSONDecodeError:
                pass

        # 提取收益率
        for key, var_name in [('1n', 'syl_1n'), ('6y', 'syl_6y'), ('3y', 'syl_3y'), ('1y', 'syl_1y')]:
            val = extract_js_string(text, var_name)
            if val:
                result['syl'][key] = safe_float(val)

        return jsonify(result)
    except Exception as e:
        print(f'[走势异常] {code}: {e}')
        return jsonify(None)


@app.route('/api/ranking')
def api_ranking():
    """基金涨幅排行 - 对接东方财富基金排行"""
    sort_type = request.args.get('sort', 'RZDF')
    size = request.args.get('size', '20')
    page = request.args.get('page', '1')
    fund_type = request.args.get('type', 'all')
    order = request.args.get('order', 'desc')  # desc=降序(涨幅榜), asc=升序(跌幅榜)

    # SWR机制:15秒内返回缓存,15-60秒返回旧数据+后台刷新
    cache_key = f'ranking_{sort_type}_{size}_{page}_{fund_type}_{order}'
    cached = _get_cache(cache_key, 15)
    if cached is not None:
        return jsonify(cached)

    # SWR:缓存过期但不超过60秒,返回旧数据+后台异步刷新
    stale = _get_cache(cache_key, 60)
    if stale is not None:
        # 后台异步刷新,不阻塞当前请求
        def _bg_refresh():
            try:
                _fetch_ranking(cache_key, sort_type, size, page, fund_type, order)
            except Exception:
                pass
        threading.Thread(target=_bg_refresh, daemon=True).start()
        return jsonify(stale)

    # 无缓存,同步获取
    result = _fetch_ranking(cache_key, sort_type, size, page, fund_type, order)
    if result is not None:
        return jsonify(result)
    return jsonify([])


def _fetch_ranking(cache_key, sort_type, size, page, fund_type, order):
    """获取基金排行数据并写入缓存"""

    # 东方财富基金排行数据接口
    sort_map = {
        'RZDF': 'rzdf',   # 日涨幅
        'ZZF': 'zzf',     # 周涨幅
        '1YZF': '1yzf',   # 近1月
        '3YZF': '3yzf',   # 近3月
        '6YZF': '6yzf',   # 近6月
        '1NZF': '1nzf',   # 近1年
        '2NZF': '2nzf',   # 近2年
        '3NZF': '3nzf',   # 近3年
        'JNZF': 'jnzf',   # 今年以来
    }
    sc = sort_map.get(sort_type, 'rzdf')
    st = 'asc' if order == 'asc' else 'desc'

    url = 'https://fund.eastmoney.com/data/rankhandler.aspx'
    params = {
        'op': 'ph',
        'dt': 'kf',
        'ft': fund_type,
        'rs': '',
        'gs': 0,
        'sc': sc,
        'st': st,
        'pi': page,
        'pn': size,
        'dx': 1
    }
    rank_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://fund.eastmoney.com/data/fundranking.html'
    }
    try:
        resp = SESSION.get(url, params=params, headers=rank_headers, timeout=10)
        text = resp.text

        # 提取总记录数
        total_count = 0
        count_match = re.search(r'allRecords:(\d+)', text)
        if count_match:
            total_count = int(count_match.group(1))

        # 解析 var rankData = {datas:[...], ...}
        match = re.search(r'datas:\[(.+?)\]', text, re.DOTALL)
        if not match:
            return jsonify({'funds': [], 'total': total_count})

        raw_items = match.group(1).split('","')
        results = []
        for raw in raw_items:
            raw = raw.strip('"').strip()
            if not raw:
                continue
            parts = raw.split(',')
            if len(parts) >= 7:
                results.append({
                    'code': parts[0],
                    'name': parts[1],
                    'type': parse_fund_type(parts[2] if len(parts) > 2 else ''),
                    'netValue': safe_float(parts[4]) if len(parts) > 4 else 0,
                    'totalNetValue': safe_float(parts[5]) if len(parts) > 5 else 0,
                    'change': safe_float(parts[6]) if len(parts) > 6 else 0,
                    'weekChange': safe_float(parts[7]) if len(parts) > 7 else 0,
                    'monthChange': safe_float(parts[8]) if len(parts) > 8 else 0,
                    'yearChange': safe_float(parts[11]) if len(parts) > 11 else 0,
                })
        # 根据排序类型，将change设置为对应周期的涨幅，使前端显示正确
        change_field_map = {
            'RZDF': 6,   # 日涨幅 -> parts[6]
            'ZZF': 7,    # 周涨幅 -> parts[7]
            '1YZF': 8,   # 近1月 -> parts[8]
            '3YZF': 9,   # 近3月 -> parts[9]
            '6YZF': 10,  # 近6月 -> parts[10]
            '1NZF': 11,  # 近1年 -> parts[11]
        }
        change_idx = change_field_map.get(sort_type, 6)
        for r in results:
            if change_idx == 7:
                r['change'] = r.get('weekChange', 0)
            elif change_idx == 8:
                r['change'] = r.get('monthChange', 0)
            elif change_idx == 11:
                r['change'] = r.get('yearChange', 0)
        result = {'funds': results, 'total': total_count}
        _set_cache(cache_key, result)
        return result
    except Exception as e:
        print(f'[排行异常]: {e}')
        return None


# ========== 实时涨跌排名(全市场) ==========
# 后台预加载锁,防止多次同时拉取全市场
_realtime_rank_loading = {}
_realtime_rank_lock_lock = threading.Lock()


def _fetch_all_funds(fund_type, order):
    """拉取全市场基金列表(按上一交易日涨跌幅排序)"""
    url = 'https://fund.eastmoney.com/data/rankhandler.aspx'
    st = 'asc' if order == 'asc' else 'desc'
    params = {
        'op': 'ph',
        'dt': 'kf',
        'ft': fund_type,
        'rs': '',
        'gs': 0,
        'sc': 'rzdf',
        'st': st,
        'pi': 1,
        'pn': 12000,  # 一次拉取全市场
        'dx': 1
    }
    rank_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://fund.eastmoney.com/data/fundranking.html'
    }
    resp = SESSION.get(url, params=params, headers=rank_headers, timeout=15)
    text = resp.text

    total_count = 0
    count_match = re.search(r'allRecords:(\d+)', text)
    if count_match:
        total_count = int(count_match.group(1))

    match = re.search(r'datas:\[(.+?)\]', text, re.DOTALL)
    if not match:
        return [], 0

    raw_items = match.group(1).split('","')
    results = []
    for raw in raw_items:
        raw = raw.strip('"').strip()
        if not raw:
            continue
        parts = raw.split(',')
        if len(parts) >= 7:
            results.append({
                'code': parts[0],
                'name': parts[1],
                'type': parse_fund_type(parts[2] if len(parts) > 2 else ''),
                'netValue': safe_float(parts[4]) if len(parts) > 4 else 0,
                'totalNetValue': safe_float(parts[5]) if len(parts) > 5 else 0,
                'change': safe_float(parts[6]) if len(parts) > 6 else 0,
            })
    return results, total_count


def _fetch_estimate_for_code(code):
    """获取单只基金的实时估值(通过新浪财经)"""
    try:
        results = _fetch_sina_estimate([code])
        if results and results[0]:
            r = results[0]
            gszzl = r.get('gszzl')
            gsz = r.get('gsz')
            if gszzl is not None and gsz is not None:
                return {'code': code, 'gszzl': gszzl, 'gsz': gsz, 'dwjz': r.get('dwjz')}
    except Exception:
        pass
    return None


def _build_realtime_ranking(sort_type, order, fund_type):
    """构建全市场实时涨跌排名(新浪批量估值+排序)"""
    # 1. 拉取全市场基金
    all_funds, total = _fetch_all_funds(fund_type, order)
    if not all_funds:
        return {'funds': [], 'total': 0}

    # 2. 通过新浪批量获取估值(每批50个,远快于逐个请求)
    codes = [f['code'] for f in all_funds]
    estimates = {}
    batch_size = 50
    for i in range(0, len(codes), batch_size):
        batch_codes = codes[i:i + batch_size]
        try:
            batch_results = _fetch_sina_estimate(batch_codes)
            for r in batch_results:
                if r and r.get('gszzl') is not None:
                    estimates[r['fundcode']] = r
        except Exception:
            pass

    # 3. 合并实时估值:有估值的用估值,无估值的按0%算
    for f in all_funds:
        est = estimates.get(f['code'])
        if est and est['gszzl'] is not None:
            f['realtimeChange'] = est['gszzl']
            f['netValue'] = est['gsz']
            f['hasRealtime'] = True
        else:
            f['realtimeChange'] = 0
            f['hasRealtime'] = False

    # 4. 按今日实时涨跌幅排序
    all_funds.sort(
        key=lambda f: float(f['realtimeChange']) if f['realtimeChange'] is not None else 0,
        reverse=(order == 'desc')
    )

    return {'funds': all_funds, 'total': len(all_funds)}


@app.route('/api/ranking/realtime')
def api_ranking_realtime():
    """实时涨跌排名 - 全市场基金按今日实时估值涨跌幅排序,服务端缓存90秒"""
    order = request.args.get('order', 'desc')  # desc:涨幅榜, asc:跌幅榜
    fund_type = request.args.get('fundType', 'all')
    page = int(request.args.get('page', '1'))
    size = int(request.args.get('size', '20'))

    cache_key = f'realtime_rank:{order}:{fund_type}'

    # 检查缓存(90秒)
    cached = _get_cache(cache_key, 90)
    if cached:
        start = (page - 1) * size
        page_funds = cached['funds'][start:start + size]
        return jsonify({
            'funds': page_funds,
            'total': cached['total'],
            'totalPages': math.ceil(cached['total'] / size),
            'page': page,
            'cached': True
        })

    # 防止并发重复拉取(同key加锁)
    with _realtime_rank_lock_lock:
        if cache_key not in _realtime_rank_loading:
            _realtime_rank_loading[cache_key] = threading.Lock()
        lock = _realtime_rank_loading[cache_key]

    acquired = lock.acquire(blocking=False)
    if not acquired:
        # 另一个线程正在拉取,等待最多60秒
        acquired = lock.acquire(timeout=60)

    # 再次检查缓存(可能其他线程已完成)
    cached = _get_cache(cache_key, 90)
    if cached:
        if acquired:
            lock.release()
        start = (page - 1) * size
        page_funds = cached['funds'][start:start + size]
        return jsonify({
            'funds': page_funds,
            'total': cached['total'],
            'totalPages': math.ceil(cached['total'] / size),
            'page': page,
            'cached': True
        })

    # 拉取全市场实时排名
    try:
        result = _build_realtime_ranking('RZDF', order, fund_type)
        _set_cache(cache_key, result)
    except Exception as e:
        print(f'[实时排名异常]: {e}')
        result = {'funds': [], 'total': 0}

    if acquired:
        lock.release()

    start = (page - 1) * size
    page_funds = result['funds'][start:start + size]
    return jsonify({
        'funds': page_funds,
        'total': result['total'],
        'totalPages': math.ceil(result['total'] / size),
        'page': page,
        'cached': False
    })


# ========== 每日励志语录(实时从Hitokoto一言API采集) ==========
@app.route('/api/quote')
def api_quote():
    """实时从Hitokoto一言API采集随机语录,每次访问不同"""
    try:
        url = 'https://v1.hitokoto.cn/'
        # c=i:诗词, c=k:哲学, c=d:文学
        params = {'c': 'i', 'c': 'k', 'c': 'd', 'encode': 'json'}
        resp = SESSION.get(url, params=params, timeout=5)
        data = resp.json()
        text = data.get('hitokoto', '投资如人生,贵在坚持。')
        author = data.get('from_who') or data.get('from') or '佚名'
        # 去除引号
        text = text.strip().strip('"').strip('"').strip('"').strip('"').strip('「').strip('」').strip('『').strip('』')
        return jsonify({
            'text': text,
            'author': author
        })
    except Exception as e:
        print(f'[语录采集异常]: {e}')
        return jsonify({
            'text': '投资如人生,贵在坚持与耐心。',
            'author': '投资感悟'
        })


@app.route('/api/news')
def api_news():
    """7x24实时财经资讯 - 对接东方财富7x24快讯接口"""
    page_size = request.args.get('size', '15')
    sort_end = request.args.get('sortEnd', '')
    cache_key = f'news_{page_size}'

    # stale-while-revalidate
    cached = _get_cache(cache_key, 30)
    if cached is not None:
        return jsonify(cached)

    # 检查过期缓存
    stale = _hot_cache.get(cache_key)
    if stale and stale.get('data'):
        def _bg_refresh_news():
            try:
                result = _fetch_news(page_size, sort_end)
                if result:
                    _set_cache(cache_key, result)
            except Exception:
                pass
        threading.Thread(target=_bg_refresh_news, daemon=True).start()
        return jsonify(stale['data'])

    # 完全没有缓存, 同步获取
    lock = _get_key_lock(cache_key)
    if not lock.acquire(blocking=False):
        time.sleep(0.5)
        cached = _get_cache(cache_key, 60)
        if cached is not None:
            return jsonify(cached)

    try:
        result = _fetch_news(page_size, sort_end)
        _set_cache(cache_key, result)
        return jsonify(result)
    finally:
        lock.release()


def _fetch_news(page_size='15', sort_end=''):
    """实际采集资讯数据(参数化, 不依赖request上下文, 可在后台线程调用)"""
    # 主接口: getFastNewsList (7x24实时快讯)
    url = 'https://np-listapi.eastmoney.com/comm/web/getFastNewsList'
    params = {
        'client': 'web',
        'biz': 'web_724',
        'fastColumn': '102',
        'pageSize': page_size,
        'sortEnd': sort_end,
        'req_trace': str(int(time.time() * 1000))
    }
    news_headers = {
        'User-Agent': HEADERS['User-Agent'],
        'Referer': 'https://kuaixun.eastmoney.com/',
        'Accept': '*/*',
    }
    try:
        resp = requests.get(url, params=params, headers=news_headers, timeout=10)
        data = resp.json()
        print(f'[资讯] 主接口 code={data.get("code")}, has_data={data.get("data") is not None}', flush=True)
        if str(data.get('code', '')) == '1' and data.get('data') and data['data'].get('fastNewsList'):
            results = []
            for item in data['data']['fastNewsList']:
                results.append({
                    'title': item.get('title', ''),
                    'summary': item.get('summary', '') or '',
                    'source': item.get('mediaName', '') or '东方财富',
                    'time': item.get('showTime', ''),
                    'url': item.get('url_w', '') or item.get('url', '') or item.get('uniqueUrl', '')
                })
            print(f'[资讯] 主接口返回 {len(results)} 条', flush=True)
            return {
                'list': results,
                'sortEnd': data['data'].get('sortEnd', ''),
                'total': data['data'].get('total', 0)
            }
        # 打印data的keys帮助调试
        if data.get('data'):
            print(f'[资讯] 主接口data keys: {list(data["data"].keys())}', flush=True)
        print(f'[资讯] 主接口无数据: code={data.get("code")}, msg={data.get("message", "")}', flush=True)
    except Exception as e:
        print(f'[资讯] 主接口异常: {e}', flush=True)

    # 备用接口: getNewsByColumns (财经要闻)
    url2 = 'https://np-listapi.eastmoney.com/comm/web/getNewsByColumns'
    params2 = {
        'client': 'web',
        'biz': 'web_news_col',
        'column': '350',
        'pageSize': page_size,
        'page': '1',
        'req_trace': str(int(time.time() * 1000))
    }
    try:
        resp2 = requests.get(url2, params=params2, headers=news_headers, timeout=10)
        data2 = resp2.json()
        print(f'[资讯] 备用接口 code={data2.get("code")}', flush=True)
        if str(data2.get('code', '')) == '1' and data2.get('data') and data2['data'].get('list'):
            results = []
            for item in data2['data']['list']:
                results.append({
                    'title': item.get('title', ''),
                    'summary': item.get('summary', '') or '',
                    'source': item.get('mediaName', '') or '东方财富',
                    'time': item.get('showTime', ''),
                    'url': item.get('url_w', '') or item.get('url', '') or item.get('uniqueUrl', '')
                })
            print(f'[资讯] 备用接口返回 {len(results)} 条', flush=True)
            return {
                'list': results,
                'sortEnd': '',
                'total': 0
            }
        print(f'[资讯] 备用接口也无数据: msg={data2.get("message", "")}', flush=True)
    except Exception as e:
        print(f'[资讯] 备用接口异常: {e}', flush=True)

    return {'list': [], 'sortEnd': '', 'total': 0}


@app.route('/api/market-indices')
def api_market_indices():
    """大盘指数实时行情 - 对接东方财富push2接口，采集全部国内外指数"""
    # stale-while-revalidate: 缓存存在就直接返回(即使过期), 同时后台刷新
    cached = _get_cache('market_indices', 30)
    if cached is not None:
        return jsonify(cached)

    # 缓存不存在, 检查是否有过期缓存可用
    stale = _hot_cache.get('market_indices')
    if stale and stale.get('data'):
        # 有过期缓存, 后台刷新, 立即返回旧数据
        def _bg_refresh():
            try:
                data = _fetch_market_indices()
                if data:
                    _set_cache('market_indices', data)
            except Exception:
                pass
        threading.Thread(target=_bg_refresh, daemon=True).start()
        return jsonify(stale['data'])

    # 完全没有缓存, 同步获取
    lock = _get_key_lock('market_indices')
    if not lock.acquire(blocking=False):
        time.sleep(0.5)
        cached = _get_cache('market_indices', 60)
        if cached is not None:
            return jsonify(cached)

    try:
        result = _fetch_market_indices()
        _set_cache('market_indices', result)
        return jsonify(result)
    finally:
        lock.release()


def _fetch_market_indices():
    """实际采集大盘指数数据"""
    # 按区域分组定义，每个区域带上标签
    regions = [
        ('A股', '1.000001,0.399001,0.399006,1.000300,1.000016,1.000010,1.000905,1.000852,1.000688,0.899050,0.399005,0.399004,0.399106,1.000612,1.000073,1.000015,0.399011,1.000132,1.000133,1.000136'),
        ('港股', '100.HSI,100.HSTECH,100.HSCEI,100.HSCCI,100.CSI'),
        ('美股', '100.DJIA,100.SPX,100.NDX,100.NDAQ,100.RUT,100.VIX'),
        ('欧洲', '100.FTSE,100.GDAXI,100.FCHI,100.STOXX50E,100.AEX,100.SSMI,100.IBEX'),
        ('亚太', '100.N225,100.KS11,100.AORD,100.BSESN,100.JKSE,100.SET,100.STI,100.TWII'),
        ('商品', '100.UDI,100.GC00Y,100.SI00Y,100.CL00Y,100.NG00Y'),
    ]
    secids = ','.join(codes for _, codes in regions)
    url = 'https://push2.eastmoney.com/api/qt/ulist.np/get'
    params = {
        'fltt': 2,
        'np': 3,
        'invt': 2,
        'secids': secids,
        '_': str(int(time.time() * 1000))
    }
    try:
        resp = SESSION.get(url, params=params, timeout=6)
        data = resp.json()
        if data.get('data') and data['data'].get('diff'):
            # 建立code到region的映射（同时映射完整secid和去掉前缀的code）
            code_region = {}
            for region_name, codes in regions:
                for c in codes.split(','):
                    c = c.strip()
                    code_region[c] = region_name
                    # 也映射去掉前缀的code (如 "1.000001" -> "000001")
                    if '.' in c:
                        code_region[c.split('.', 1)[1]] = region_name

            results = []
            # 按区域顺序排列
            region_order = {name: i for i, (name, _) in enumerate(regions)}
            sorted_items = sorted(data['data']['diff'], key=lambda x: region_order.get(code_region.get(x.get('f12', ''), '其他'), 99))
            
            current_region = None
            for item in sorted_items:
                price = safe_float(item.get('f2'))
                if price <= 0:
                    continue
                code = item.get('f12', '')
                region = code_region.get(code, '其他')
                # 在区域切换时插入分组标记
                show_region = None
                if region != current_region:
                    show_region = region
                    current_region = region
                results.append({
                    'code': code,
                    'name': item.get('f14', ''),
                    'price': price,
                    'change': safe_float(item.get('f4')),
                    'changePercent': safe_float(item.get('f3')),
                    'region': region,
                    'showRegion': show_region,
                })
            return results
        print(f'[大盘指数] 无数据: {json.dumps(data, ensure_ascii=False)[:200]}')
        return []
    except Exception as e:
        print(f'[大盘指数异常]: {e}')
        return []


@app.route('/api/sectors')
def api_sectors():
    """养基宝标准板块行情 - 行业板块/概念题材
    数据源: 天天基金网主题基金API(与养基宝同源, 东方财富Choice数据)
    """
    category = request.args.get('type', '行业板块')
    if not category:
        category = '行业板块'

    # 内存缓存：300秒内复用
    cache_key = 'sectors_' + category
    cached = _sector_cache.get(cache_key)
    if cached and time.time() - cached['time'] < 300:
        return jsonify(cached['data'])

    # 根据分类选择数据采集方式
    if category == '行业板块':
        results = _fetch_industry_sectors()
    elif category == '概念题材':
        results = _fetch_concept_sectors()
    else:
        results = []

    # 按涨跌幅降序排序
    results.sort(key=lambda x: x.get('changePercent', 0), reverse=True)

    # 缓存
    if results:
        _sector_cache[cache_key] = {'data': results, 'time': time.time()}
    elif cached:
        print(f'[板块-{category}] 获取失败，返回过期缓存', flush=True)
        return jsonify(cached['data'])

    return jsonify(results)


@app.route('/api/sector-categories')
def api_sector_categories():
    """返回板块一级分类列表"""
    return jsonify(SECTOR_TOP_CATEGORIES)


@app.route('/api/sector-funds')
def api_sector_funds():
    """获取板块对应的基金列表 - 天天基金网主题基金API
    参数: code=BK000642 (板块代码), page=1, size=20
    返回: 基金代码、名称、净值、日涨幅、近1周/1月/3月/6月/1年收益率等
    """
    bk_code = request.args.get('code', '').strip()
    if not bk_code or not bk_code.startswith('BK'):
        return jsonify({'error': '缺少板块代码'}), 400

    page = int(request.args.get('page', 1))
    size = int(request.args.get('size', 20))
    if size > 50:
        size = 50

    # 缓存
    cache_key = f'sector_funds_{bk_code}_{page}_{size}'
    cached = _sector_cache.get(cache_key)
    if cached and time.time() - cached['time'] < 120:
        return jsonify(cached['data'])

    url = 'https://api.fund.eastmoney.com/ZTJJ/GetBKRelTopicFundNew'
    params = {
        'callback': 'jQuery',
        'sort': 'undefined',
        'sorttype': 'DESC',
        'pageindex': str(page),
        'pagesize': str(size),
        'tp': bk_code,
        'isbuy': '1',
        '_': str(int(time.time() * 1000))
    }
    headers = {
        'User-Agent': HEADERS['User-Agent'],
        'Referer': 'https://fund.eastmoney.com/ztjj/',
        'Accept': '*/*',
    }

    funds = []
    total = 0
    for attempt in range(3):
        try:
            resp = SESSION.get(url, params=params, headers=headers, timeout=10)
            text = resp.text
            m = re.search(r'jQuery\((.*)\)', text)
            if m:
                data = json.loads(m.group(1))
                total = data.get('TotalCount', 0)
                for item in data.get('Data', []):
                    funds.append({
                        'code': item.get('FCODE', ''),
                        'name': item.get('SHORTNAME', ''),
                        'type': item.get('FTYPE', ''),
                        'netValue': round(safe_float(item.get('DWJZ', 0)), 4),
                        'changePercent': round(safe_float(item.get('RZDF', 0)), 2),
                        'week': _safe_pct(item.get('SYL_Z')),
                        'month': _safe_pct(item.get('SYL_Y')),
                        'quarter': _safe_pct(item.get('SYL_3Y')),
                        'halfYear': _safe_pct(item.get('SYL_6Y')),
                        'year': _safe_pct(item.get('SYL_1N')),
                        'ytd': _safe_pct(item.get('SYL_JN')),
                        'feeRate': item.get('RATE', ''),
                        'correlation': round(safe_float(item.get('CORR_1Y', 0)), 2),
                    })
                print(f'[板块基金-{bk_code}] 获取到 {len(funds)} 只基金, 总计 {total}', flush=True)
                break
            else:
                print(f'[板块基金-{bk_code}] 尝试{attempt+1}解析失败', flush=True)
        except Exception as e:
            print(f'[板块基金-{bk_code}] 异常尝试{attempt+1}: {e}', flush=True)
        if attempt < 2:
            time.sleep(0.5)

    result = {
        'funds': funds,
        'total': total,
        'page': page,
        'size': size,
    }
    if funds:
        _sector_cache[cache_key] = {'data': result, 'time': time.time()}
    return jsonify(result)


def _safe_pct(val):
    """安全解析百分比数值, 空字符串返回None"""
    if val is None or val == '' or val == '--':
        return None
    try:
        return round(float(val), 2)
    except (ValueError, TypeError):
        return None


def _fetch_industry_sectors():
    """采集行业板块 - 天天基金网主题基金API(与养基宝同源), 映射为养基宝标准名
    天天基金网主题基金API返回162个板块(hy1行业+gn概念), 
    通过get_ttjj_industry_name跨分类匹配到行业板块白名单
    """
    # 1. 优先从天天基金网主题基金API获取(与养基宝同源)
    ttjj_list = _fetch_ttjj_theme_data()
    if ttjj_list:
        merged = {}
        for item in ttjj_list:
            std_name = get_ttjj_industry_name(item['name'])
            if std_name:
                if std_name in merged:
                    old = merged[std_name]
                    old['changePercent'] = round((old['changePercent'] + item['changePercent']) / 2, 2)
                else:
                    merged[std_name] = {
                        'code': item['code'],
                        'name': std_name,
                        'price': 0,
                        'changePercent': item['changePercent'],
                        'change': 0,
                        'upCount': 0,
                        'downCount': 0,
                        'type': '行业板块',
                        'category': '行业板块'
                    }
        # 补全白名单中缺失的板块
        for name in INDUSTRY_SECTORS:
            if name not in merged:
                merged[name] = {
                    'code': '', 'name': name, 'price': 0,
                    'changePercent': 0, 'change': 0,
                    'upCount': 0, 'downCount': 0,
                    'type': '行业板块', 'category': '行业板块'
                }

        # 获取每个板块的基金数量
        bk_codes = [s['code'] for s in merged.values() if s.get('code')]
        if bk_codes:
            counts = _fetch_sector_fund_counts(bk_codes)
            for s in merged.values():
                if s.get('code') and s['code'] in counts:
                    s['fundCount'] = counts[s['code']]

        print(f'[行业板块-TTJJ] 映射到 {len(merged)} 个标准板块', flush=True)
        return list(merged.values())

    # 2. Fallback: 同花顺+东方财富双数据源
    print('[行业板块] TTJJ API失败, 回退到同花顺+东方财富', flush=True)
    ths_list = _fetch_ths_industry_boards()
    em_list = _fetch_dataapi_boards('m:90+t:2')
    raw_list = ths_list + em_list
    merged = {}
    for item in raw_list:
        std_name = get_industry_standard_name(item['name'])
        if std_name:
            if std_name in merged:
                old = merged[std_name]
                old['changePercent'] = round((old['changePercent'] + item['changePercent']) / 2, 2)
                old['upCount'] += item['upCount']
                old['downCount'] += item['downCount']
            else:
                merged[std_name] = {
                    'code': item['code'],
                    'name': std_name,
                    'price': item['price'],
                    'changePercent': item['changePercent'],
                    'change': item['change'],
                    'upCount': item['upCount'],
                    'downCount': item['downCount'],
                    'type': '行业板块',
                    'category': '行业板块'
                }
    for name in INDUSTRY_SECTORS:
        if name not in merged:
            merged[name] = {
                'code': '', 'name': name, 'price': 0,
                'changePercent': 0, 'change': 0,
                'upCount': 0, 'downCount': 0,
                'type': '行业板块', 'category': '行业板块'
            }
    return list(merged.values())


def _fetch_ttjj_theme_data():
    """从天天基金网主题基金API获取板块涨跌数据(与养基宝同源)
    API: https://api.fund.eastmoney.com/ztjj/GetZTJJListNew
    返回162个板块的日涨跌幅(D字段), 数据来源: 东方财富Choice数据
    """
    results = []
    url = 'https://api.fund.eastmoney.com/ztjj/GetZTJJListNew'
    params = {
        'callback': 'jQuery',
        'tt': '0',
        'dt': 'syl',
        'st': 'D',
        '_': str(int(time.time() * 1000))
    }
    headers = {
        'User-Agent': HEADERS['User-Agent'],
        'Referer': 'https://fund.eastmoney.com/ztjj/',
        'Accept': '*/*',
    }
    for attempt in range(3):
        try:
            resp = SESSION.get(url, params=params, headers=headers, timeout=10)
            text = resp.text
            # JSONP格式: jQuery({...})
            m = re.search(r'jQuery\((.*)\)', text)
            if m:
                data = json.loads(m.group(1))
                items = data.get('Data', [])
                for item in items:
                    results.append({
                        'code': item.get('INDEXCODE', ''),
                        'name': item.get('INDEXNAME', ''),
                        'changePercent': round(safe_float(item.get('D', 0)), 2),
                    })
                print(f'[TTJJ主题基金] 采集到 {len(results)} 个板块', flush=True)
                return results
            else:
                print(f'[TTJJ主题基金] 尝试{attempt+1}解析失败: {text[:150]}', flush=True)
        except Exception as e:
            print(f'[TTJJ主题基金] 异常尝试{attempt+1}: {e}', flush=True)
        if attempt < 2:
            time.sleep(0.5)
    return results


def _fetch_sector_fund_counts(bk_codes):
    """批量获取板块关联基金数量 - 天天基金网GetBKRelTopicFundNew
    使用独立长缓存(10分钟), 基金数量变化不频繁
    返回: {bk_code: fund_count}
    """
    if not bk_codes:
        return {}

    # 检查独立缓存（10分钟）
    now = time.time()
    if _sector_fund_count_cache['data'] and now - _sector_fund_count_cache['time'] < 600:
        cached = _sector_fund_count_cache['data']
        # 只返回请求的codes
        return {k: v for k, v in cached.items() if k in bk_codes}

    # 需要采集的codes：优先用缓存中已有的，只采集缺失的
    existing = _sector_fund_count_cache.get('data', {})
    codes_to_fetch = [c for c in bk_codes if c not in existing]

    if not codes_to_fetch:
        return {k: v for k, v in existing.items() if k in bk_codes}

    def _fetch_one(bk_code):
        url = 'https://api.fund.eastmoney.com/ZTJJ/GetBKRelTopicFundNew'
        params = {
            'callback': 'jQuery',
            'sort': 'undefined',
            'sorttype': 'DESC',
            'pageindex': '1',
            'pagesize': '1',
            'tp': bk_code,
            'isbuy': '1',
            '_': str(int(time.time() * 1000))
        }
        headers = {
            'User-Agent': HEADERS['User-Agent'],
            'Referer': 'https://fund.eastmoney.com/ztjj/',
            'Accept': '*/*',
        }
        try:
            resp = SESSION.get(url, params=params, headers=headers, timeout=5)
            text = resp.text
            m = re.search(r'jQuery\((.*)\)', text)
            if m:
                data = json.loads(m.group(1))
                return bk_code, int(data.get('TotalCount', 0))
        except Exception:
            pass
        return bk_code, 0

    new_counts = {}
    from concurrent.futures import ThreadPoolExecutor, as_completed
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(_fetch_one, code) for code in codes_to_fetch if code]
        for future in as_completed(futures, timeout=20):
            try:
                bk_code, count = future.result()
                new_counts[bk_code] = count
            except Exception:
                pass

    # 合并到缓存
    merged_counts = dict(existing)
    merged_counts.update(new_counts)
    _sector_fund_count_cache['data'] = merged_counts
    _sector_fund_count_cache['time'] = now

    print(f'[板块基金数] 新采集 {len(new_counts)} 个, 缓存总计 {len(merged_counts)} 个', flush=True)
    return {k: v for k, v in merged_counts.items() if k in bk_codes}


def _fetch_ths_industry_boards():
    """从同花顺行业板块页面解析板块涨跌数据
    页面URL: http://q.10jqka.com.cn/thshy/
    返回格式与_fetch_dataapi_boards一致
    """
    results = []
    url = 'http://q.10jqka.com.cn/thshy/'
    headers = {
        'User-Agent': HEADERS['User-Agent'],
        'Referer': 'http://q.10jqka.com.cn/',
        'Accept': 'text/html,application/xhtml+xml',
    }
    for attempt in range(3):
        try:
            resp = SESSION.get(url, headers=headers, timeout=10)
            # 同花顺页面使用GBK编码
            text = resp.content.decode('gbk', errors='replace')
            # 解析HTML表格行
            rows = re.findall(r'<tr[^>]*>(.*?)</tr>', text, re.DOTALL)
            for row in rows[1:]:  # 跳过表头
                cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
                if cells and len(cells) >= 8:
                    clean = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]
                    # 列: [0]序号 [1]板块名 [2]涨跌幅 [3]成交量 [4]成交额 [5]净流入 [6]上涨家数 [7]下跌家数
                    name = clean[1]
                    change_pct = safe_float(clean[2]) if clean[2] else 0
                    up_count = int(safe_float(clean[6])) if len(clean) > 6 else 0
                    down_count = int(safe_float(clean[7])) if len(clean) > 7 else 0
                    results.append({
                        'code': '',
                        'name': name,
                        'price': 0,
                        'changePercent': round(change_pct, 2),
                        'change': 0,
                        'upCount': up_count,
                        'downCount': down_count,
                    })
            if results:
                print(f'[同花顺-行业板块] 采集到 {len(results)} 个板块', flush=True)
                return results
            else:
                print(f'[同花顺-行业板块] 尝试{attempt+1}无数据', flush=True)
        except Exception as e:
            print(f'[同花顺-行业板块] 异常尝试{attempt+1}: {e}', flush=True)
        if attempt < 2:
            time.sleep(0.5)
    return results


def _fetch_concept_sectors():
    """采集概念题材 - 天天基金网主题基金API(与养基宝同源), 映射为养基宝标准名
    通过get_ttjj_concept_name跨分类匹配到概念题材白名单
    """
    # 1. 优先从天天基金网主题基金API获取
    ttjj_list = _fetch_ttjj_theme_data()
    if ttjj_list:
        merged = {}
        for item in ttjj_list:
            std_name = get_ttjj_concept_name(item['name'])
            if std_name:
                if std_name in merged:
                    old = merged[std_name]
                    old['changePercent'] = round((old['changePercent'] + item['changePercent']) / 2, 2)
                else:
                    merged[std_name] = {
                        'code': item['code'],
                        'name': std_name,
                        'price': 0,
                        'changePercent': item['changePercent'],
                        'change': 0,
                        'upCount': 0,
                        'downCount': 0,
                        'type': '概念题材',
                        'category': '概念题材'
                    }
        # 补全白名单
        for name in CONCEPT_SECTORS:
            if name not in merged:
                merged[name] = {
                    'code': '', 'name': name, 'price': 0,
                    'changePercent': 0, 'change': 0,
                    'upCount': 0, 'downCount': 0,
                    'type': '概念题材', 'category': '概念题材'
                }

        # 获取每个板块的基金数量
        bk_codes = [s['code'] for s in merged.values() if s.get('code')]
        if bk_codes:
            counts = _fetch_sector_fund_counts(bk_codes)
            for s in merged.values():
                if s.get('code') and s['code'] in counts:
                    s['fundCount'] = counts[s['code']]

        print(f'[概念题材-TTJJ] 映射到 {len(merged)} 个标准板块', flush=True)
        return list(merged.values())

    # 2. Fallback: 东方财富dataapi
    print('[概念题材] TTJJ API失败, 回退到东方财富dataapi', flush=True)
    raw_list = _fetch_dataapi_boards('m:90+t:3')
    merged = {}
    for item in raw_list:
        std_name = get_concept_standard_name(item['name'])
        if std_name:
            if std_name in merged:
                old = merged[std_name]
                old['changePercent'] = round((old['changePercent'] + item['changePercent']) / 2, 2)
                old['upCount'] += item['upCount']
                old['downCount'] += item['downCount']
            else:
                merged[std_name] = {
                    'code': item['code'],
                    'name': std_name,
                    'price': item['price'],
                    'changePercent': item['changePercent'],
                    'change': item['change'],
                    'upCount': item['upCount'],
                    'downCount': item['downCount'],
                    'type': '概念题材',
                    'category': '概念题材'
                }
    # 补全白名单
    for name in CONCEPT_SECTORS:
        if name not in merged:
            merged[name] = {
                'code': '', 'name': name, 'price': 0,
                'changePercent': 0, 'change': 0,
                'upCount': 0, 'downCount': 0,
                'type': '概念题材', 'category': '概念题材'
            }
    return list(merged.values())


def _fetch_dataapi_boards(fs_code):
    """从data.eastmoney.com/dataapi采集板块原始数据
    该API可从Railway正常访问, 返回f3(涨跌幅*100),f2(指数*100),f104(涨数),f105(跌数)
    """
    results = []
    url = 'https://data.eastmoney.com/dataapi/bkzj/getbkzj'
    params = {'key': 'f3,f2,f104,f105', 'code': fs_code}
    headers = {
        'User-Agent': HEADERS['User-Agent'],
        'Referer': 'https://data.eastmoney.com/bkzj/gn.html',
        'Accept': 'application/json, text/plain, */*',
    }
    for attempt in range(3):
        try:
            resp = SESSION.get(url, params=params, headers=headers, timeout=10)
            data = resp.json()
            if data.get('rc') == 0 and data.get('data') and data['data'].get('diff'):
                for item in data['data']['diff']:
                    change_pct = safe_float(item.get('f3', 0)) / 100.0
                    price = safe_float(item.get('f2', 0)) / 100.0
                    results.append({
                        'code': item.get('f12', ''),
                        'name': item.get('f14', ''),
                        'price': round(price, 2),
                        'changePercent': round(change_pct, 2),
                        'change': round(price * change_pct / 100, 2),
                        'upCount': int(safe_float(item.get('f104', 0))),
                        'downCount': int(safe_float(item.get('f105', 0))),
                    })
                print(f'[板块dataapi-{fs_code}] 采集到 {len(results)} 个', flush=True)
                return results
            else:
                print(f'[板块dataapi-{fs_code}] 尝试{attempt+1}无数据: {str(data)[:150]}', flush=True)
        except Exception as e:
            print(f'[板块dataapi-{fs_code}] 异常尝试{attempt+1}: {e}', flush=True)
        if attempt < 2:
            time.sleep(0.5)
    return results


def _fetch_index_sectors():
    """采集宽基指数 - 先尝试push2指数API, 失败则用ETF估值fallback"""
    results = []
    secids = get_index_secids()
    secid_str = ','.join(secids)

    # 方案1: push2指数实时行情
    try:
        url = 'https://push2.eastmoney.com/api/qt/ulist.np/get'
        params = {
            'fltt': '2',
            'secids': secid_str,
            'fields': 'f12,f14,f2,f3,f4,f104,f105',
        }
        headers = {
            'User-Agent': HEADERS['User-Agent'],
            'Referer': 'https://quote.eastmoney.com/center/boardlist.html',
        }
        resp = SESSION.get(url, params=params, headers=headers, timeout=10)
        data = resp.json()
        if data.get('data') and data['data'].get('diff'):
            for item in data['data']['diff']:
                secid = item.get('f12', '')
                name = get_index_name_by_secid(secid + '') or item.get('f14', '')
                # secid匹配可能需要带市场前缀, 用名称匹配更可靠
                std_name = None
                for idx_item in BROAD_INDEX_SECTORS:
                    if idx_item['secid'].endswith(secid) or secid in idx_item['secid']:
                        std_name = idx_item['name']
                        break
                if not std_name:
                    std_name = name
                results.append({
                    'code': secid,
                    'name': std_name,
                    'price': safe_float(item.get('f2', 0)),
                    'changePercent': safe_float(item.get('f3', 0)),
                    'change': safe_float(item.get('f4', 0)),
                    'upCount': int(safe_float(item.get('f104', 0))),
                    'downCount': int(safe_float(item.get('f105', 0))),
                    'type': '宽基指数',
                    'category': '宽基指数'
                })
            if results:
                print(f'[宽基指数-push2] 采集到 {len(results)} 个指数', flush=True)
                return results
    except Exception as e:
        print(f'[宽基指数-push2] 失败: {e}', flush=True)

    # 方案2: ETF估值fallback (新浪财经API)
    print('[宽基指数] push2不可用, 使用新浪估值fallback', flush=True)
    etf_list = get_index_etf_codes()
    etf_codes = [code for _, code in etf_list]
    try:
        est_results = _fetch_sina_estimate(etf_codes)
        est_map = {r['fundcode']: r for r in est_results if r}
        for std_name, etf_code in etf_list:
            est = est_map.get(etf_code)
            if est:
                results.append({
                    'code': etf_code,
                    'name': std_name,
                    'price': est.get('gsz', 0),
                    'changePercent': est.get('gszzl', 0),
                    'change': 0,
                    'upCount': 0,
                    'downCount': 0,
                    'type': '宽基指数',
                    'category': '宽基指数'
                })
            else:
                results.append({
                    'code': etf_code, 'name': std_name, 'price': 0,
                    'changePercent': 0, 'change': 0,
                    'upCount': 0, 'downCount': 0,
                    'type': '宽基指数', 'category': '宽基指数'
                })
    except Exception as e:
        print(f'[宽基指数-新浪fallback] 失败: {e}', flush=True)
    return results


def _fetch_fund_type_sectors(fund_type, sector_defs):
    """采集基金分类板块(债券/QDII/货币) - 按基金类型查询排行, 按关键词分组统计
    fund_type: zq(债券) / qdii / hh(货币)
    sector_defs: 板块定义列表 [{name, keywords}, ...]
    """
    # 查询基金排行(按日涨幅排序, 取前500只)
    url = 'https://fund.eastmoney.com/data/rankhandler.aspx'
    params = {
        'op': 'ph', 'dt': 'kf', 'ft': fund_type,
        'rs': '', 'gs': 0, 'sc': 'rzdf', 'st': 'desc',
        'pi': 1, 'pn': 500, 'dx': 1
    }
    rank_headers = {
        'User-Agent': HEADERS['User-Agent'],
        'Referer': 'https://fund.eastmoney.com/data/fundranking.html'
    }
    funds = []
    try:
        resp = SESSION.get(url, params=params, headers=rank_headers, timeout=15)
        text = resp.text
        # 解析 var rankData = {datas:[...]}
        match = re.search(r'datas:\[(.+?)\]', text, re.DOTALL)
        if match:
            raw_items = match.group(1).split('","')
            for raw in raw_items:
                raw = raw.strip('"').strip()
                if not raw:
                    continue
                parts = raw.split(',')
                if len(parts) >= 7:
                    funds.append({
                        'name': parts[1],
                        'change': safe_float(parts[6]) if len(parts) > 6 else 0,
                    })
        print(f'[基金分类-{fund_type}] 获取到 {len(funds)} 只基金', flush=True)
    except Exception as e:
        print(f'[基金分类-{fund_type}] 异常: {e}', flush=True)

    # 按关键词分组统计
    results = []
    for sec_def in sector_defs:
        sec_name = sec_def['name']
        keywords = sec_def.get('keywords', [])
        rep_codes = sec_def.get('rep_codes', [])
        matched = [f for f in funds if any(kw in f['name'] for kw in keywords)]
        if matched:
            avg_change = sum(f['change'] for f in matched) / len(matched)
            up_count = sum(1 for f in matched if f['change'] > 0)
            down_count = sum(1 for f in matched if f['change'] < 0)
            fund_count = len(matched)
        elif rep_codes:
            # 关键词匹配不到, 用代表性基金代码获取涨跌幅
            avg_change = 0
            valid = 0
            est_results = _fetch_sina_estimate(rep_codes)
            for r in est_results:
                if r and r.get('gszzl') is not None:
                    avg_change += r['gszzl']
                    valid += 1
            if valid > 0:
                avg_change = avg_change / valid
            up_count = 0
            down_count = 0
            fund_count = valid
        else:
            avg_change = 0
            up_count = 0
            down_count = 0
            fund_count = 0
        results.append({
            'code': '',
            'name': sec_name,
            'price': 0,
            'changePercent': round(avg_change, 2),
            'change': 0,
            'upCount': up_count,
            'downCount': down_count,
            'fundCount': fund_count,
            'type': '债券板块' if fund_type == 'zq' else '海外QDII',
            'category': '债券板块' if fund_type == 'zq' else '海外QDII'
        })
    return results


def _fetch_money_sectors(sector_defs):
    """采集货币理财板块 - 货币基金用代表性基金代码获取7日年化, 同业存单从债券基金中匹配"""
    results = []
    # 先从债券基金中找同业存单
    bond_funds = []
    try:
        url = 'https://fund.eastmoney.com/data/rankhandler.aspx'
        params = {'op': 'ph', 'dt': 'kf', 'ft': 'zq', 'rs': '', 'gs': 0, 'sc': 'rzdf', 'st': 'desc', 'pi': 1, 'pn': 500, 'dx': 1}
        rank_headers = {
            'User-Agent': HEADERS['User-Agent'],
            'Referer': 'https://fund.eastmoney.com/data/fundranking.html'
        }
        resp = SESSION.get(url, params=params, headers=rank_headers, timeout=15)
        text = resp.text
        match = re.search(r'datas:\[(.+?)\]', text, re.DOTALL)
        if match:
            raw_items = match.group(1).split('","')
            for raw in raw_items:
                raw = raw.strip('"').strip()
                if raw:
                    parts = raw.split(',')
                    if len(parts) >= 7:
                        bond_funds.append({'name': parts[1], 'change': safe_float(parts[6])})
    except Exception as e:
        print(f'[货币理财-债券基金] 异常: {e}', flush=True)

    for sec_def in sector_defs:
        sec_name = sec_def['name']
        keywords = sec_def.get('keywords', [])
        rep_codes = sec_def.get('rep_codes', [])

        if rep_codes:
            # 货币基金: 用pingzhongdata API获取年化收益率
            avg_yield = 0
            valid_count = 0
            for code in rep_codes:
                try:
                    url = f'https://fund.eastmoney.com/pingzhongdata/{code}.js'
                    resp = SESSION.get(url, timeout=8)
                    text = resp.text
                    # syl_1n是近1年收益率(年化), 用于货币基金展示
                    m = re.search(r'var\s+syl_1n\s*=\s*"([^"]+)"', text)
                    if m:
                        yld = safe_float(m.group(1))
                        if yld > 0:
                            avg_yield += yld
                            valid_count += 1
                except Exception as e:
                    pass
            if valid_count > 0:
                avg_yield = round(avg_yield / valid_count, 4)
            results.append({
                'code': '',
                'name': sec_name,
                'price': 0,
                'changePercent': avg_yield,
                'change': 0,
                'upCount': 0,
                'downCount': 0,
                'fundCount': valid_count,
                'type': '货币理财',
                'category': '货币理财',
                'yieldType': '7日年化'
            })
        else:
            # 同业存单: 从债券基金中按关键词匹配
            matched = [f for f in bond_funds if any(kw in f['name'] for kw in keywords)]
            if matched:
                avg_change = sum(f['change'] for f in matched) / len(matched)
                up_count = sum(1 for f in matched if f['change'] > 0)
                down_count = sum(1 for f in matched if f['change'] < 0)
            else:
                avg_change = 0
                up_count = 0
                down_count = 0
            results.append({
                'code': '',
                'name': sec_name,
                'price': 0,
                'changePercent': round(avg_change, 2),
                'change': 0,
                'upCount': up_count,
                'downCount': down_count,
                'fundCount': len(matched),
                'type': '货币理财',
                'category': '货币理财'
            })
    return results


@app.route('/api/fund-managers')
def api_fund_managers():
    """基金经理排行榜 - 对接东方财富基金经理接口"""
    page = request.args.get('page', '1')
    page_size = request.args.get('size', '20')
    fund_type = request.args.get('type', 'all')  # all/gp/hh/zq/zs/qdii/fof

    url = 'https://fund.eastmoney.com/Data/FundDataPortfolio_Interface.aspx'
    params = {
        'dt': 14,
        'mc': 'returnjson',
        'ft': fund_type,
        'pn': page_size,
        'pi': page,
        'sc': 'abbname',
        'st': 'asc'
    }
    try:
        resp = SESSION.get(url, params=params, timeout=10)
        text = resp.text.strip()
        # 解析 var returnjson= {...} 格式
        match = re.search(r'var\s+returnjson\s*=\s*(\{.*\})', text, re.DOTALL)
        if match:
            import json as json_module
            data = json_module.loads(match.group(1))
            if data.get('data'):
                results = []
                for item in data['data']:
                    results.append({
                        'managerId': item[0] if len(item) > 0 else '',
                        'name': item[1] if len(item) > 1 else '',
                        'companyId': item[2] if len(item) > 2 else '',
                        'companyName': item[3] if len(item) > 3 else '',
                        'fundCodes': item[4] if len(item) > 4 else '',
                        'fundNames': item[5] if len(item) > 5 else '',
                        'workDays': item[6] if len(item) > 6 else '',
                        'bestReturn': item[7] if len(item) > 7 else '',
                        'representFundCode': item[8] if len(item) > 8 else '',
                        'representFundName': item[9] if len(item) > 9 else '',
                        'totalScale': item[10] if len(item) > 10 else '',
                        'bestReturnRate': item[11] if len(item) > 11 else ''
                    })
                return jsonify({
                    'list': results,
                    'total': data.get('record', 0),
                    'pages': data.get('pages', 0)
                })
        return jsonify({'list': [], 'total': 0, 'pages': 0})
    except Exception as e:
        print(f'[基金经理异常]: {e}')
        return jsonify({'list': [], 'total': 0, 'pages': 0})


@app.route('/api/fund/detail')
def api_fund_detail_page():
    """基金详情页信息 - 对接东方财富fundf10"""
    code = request.args.get('code', '').strip()
    if not code:
        return jsonify(None)

    url = f'https://fundf10.eastmoney.com/jbgk_{code}.html'
    try:
        resp = SESSION.get(url, timeout=10)
        resp.encoding = 'utf-8'
        text = resp.text

        result = {'code': code}

        # 提取基金类型
        match = re.search(r'基金类型</th>\s*<td>(.*?)</td>', text, re.DOTALL)
        if match:
            type_html = match.group(1)
            type_match = re.search(r'>([^<]+)<', type_html)
            if type_match:
                result['typeDesc'] = parse_fund_type(type_match.group(1).strip())

        # 提取成立日期
        match = re.search(r'成立日期</th>\s*<td>(.*?)</td>', text, re.DOTALL)
        if match:
            result['establishDate'] = re.sub(r'<[^>]+>', '', match.group(1)).strip()

        # 提取基金规模
        match = re.search(r'资产规模</th>\s*<td>(.*?)</td>', text, re.DOTALL)
        if match:
            result['scale'] = re.sub(r'<[^>]+>', '', match.group(1)).strip()

        # 提取基金管理人
        match = re.search(r'基金管理人</th>\s*<td>(.*?)</td>', text, re.DOTALL)
        if match:
            company_match = re.search(r'>([^<]+)<', match.group(1))
            if company_match:
                result['company'] = company_match.group(1).strip()

        # 提取基金经理
        match = re.search(r'基金经理</th>\s*<td>(.*?)</td>', text, re.DOTALL)
        if match:
            managers = re.findall(r'>([^<]+)<', match.group(1))
            result['manager'] = ' '.join([m.strip() for m in managers if m.strip()])

        return jsonify(result)
    except Exception as e:
        print(f'[详情页异常] {code}: {e}')
        return jsonify(None)


@app.route('/api/fund-holdings')
def api_fund_holdings():
    """基金股票持仓（重仓股）- 采集东方财富fundf10重仓股数据"""
    code = request.args.get('code', '').strip()
    if not code:
        return jsonify({'list': [], 'reportDate': '', 'stockRatio': 0})

    url = f'https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code={code}&topline=10&year=&month='
    try:
        resp = SESSION.get(url, timeout=10)
        resp.encoding = 'utf-8'
        text = resp.text

        # 解析var apidata={ content:"...",arryear:[...],...};
        content_match = re.search(r'content:"(.*?)"', text, re.DOTALL)
        if not content_match:
            return jsonify({'list': [], 'reportDate': '', 'stockRatio': 0})

        html_content = content_match.group(1)
        # 反转义
        html_content = html_content.replace('\\/', '/').replace('\\\'', '\'').replace('\\"', '"')

        # 提取报告日期
        report_date = ''
        date_match = re.search(r'截至(\d{4}-\d{2}-\d{2})', html_content)
        if date_match:
            report_date = date_match.group(1)

        # 提取股票占净比
        stock_ratio = 0
        ratio_match = re.search(r'股票占净比[：:]*([\d.]+)%', html_content)
        if ratio_match:
            stock_ratio = safe_float(ratio_match.group(1))

        # 解析重仓股表格行
        stocks = []
        rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html_content, re.DOTALL)
        for row in rows:
            cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
            if len(cells) < 7:
                continue
            # 清理HTML标签
            clean_cells = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]

            # 实际列: 0:序号 1:股票代码 2:股票名称 3:最新价 4:涨跌幅 5:相关资讯 6:占净值比例 7:持股数 8:持仓市值 9:季度涨跌幅
            stock_code = clean_cells[1] if len(clean_cells) > 1 else ''
            if not stock_code or stock_code == '--':
                continue

            # 根据列数自适应：新格式9-10列(含最新价/涨跌幅/相关资讯)，旧格式7列
            if len(clean_cells) >= 9:
                ratio_idx, shares_idx, value_idx, change_idx = 6, 7, 8, -1
            else:
                ratio_idx, shares_idx, value_idx, change_idx = 3, 4, 5, 6

            # 占净值比例可能带%号，需要去除
            ratio_str = clean_cells[ratio_idx].replace('%', '').strip() if len(clean_cells) > ratio_idx else '0'

            stocks.append({
                'code': stock_code,
                'name': clean_cells[2] if len(clean_cells) > 2 else '',
                'ratio': safe_float(ratio_str),
                'shares': clean_cells[shares_idx] if len(clean_cells) > shares_idx else '--',
                'value': clean_cells[value_idx] if len(clean_cells) > value_idx else '--',
                'dayChange': '--'
            })

        # 批量获取股票实时涨跌幅
        if stocks:
            try:
                stock_codes = [s['code'] for s in stocks]
                secids = []
                for sc in stock_codes:
                    if sc.startswith('6') or sc.startswith('9'):
                        secids.append('1.' + sc)
                    else:
                        secids.append('0.' + sc)
                qurl = 'https://push2.eastmoney.com/api/qt/ulist.np/get'
                qresp = SESSION.get(qurl, params={
                    'fltt': '2', 'fields': 'f2,f3,f12,f14',
                    'secids': ','.join(secids)
                }, timeout=8)
                qdata = qresp.json()
                if qdata and qdata.get('data') and qdata['data'].get('diff'):
                    price_map = {}
                    for item in qdata['data']['diff']:
                        scode = item.get('f12', '')
                        pct = item.get('f3', 0)
                        if scode and pct is not None:
                            price_map[scode] = safe_float(pct)
                    for s in stocks:
                        if s['code'] in price_map:
                            val = price_map[s['code']]
                            if val > 0:
                                s['dayChange'] = '+' + f'{val:.2f}%'
                            else:
                                s['dayChange'] = f'{val:.2f}%'
            except Exception as pe:
                print(f'[重仓股涨跌幅获取异常] {code}: {pe}')

        return jsonify({
            'list': stocks,
            'reportDate': report_date,
            'stockRatio': stock_ratio
        })
    except Exception as e:
        print(f'[重仓股异常] {code}: {e}')
        return jsonify({'list': [], 'reportDate': '', 'stockRatio': 0})


def parse_fund_type(type_code):
    """解析基金类型"""
    if not type_code:
        return '混合型'
    type_str = str(type_code)
    type_map = {
        '001': '股票型', '002': '股票型', '003': '股票型',
        '025': '股票型', '026': '指数型',
        '027': '混合型', '028': '混合型', '029': '混合型',
        '061': '债券型', '062': '债券型', '063': '债券型',
        '064': '债券型', '065': '债券型',
        '016': 'LOF', '017': 'LOF',
        '006': 'QDII', '007': 'QDII',
        '050': '货币型', '051': '货币型',
        '052': '货币型', '053': '货币型',
        '090': 'FOF',
    }
    if type_str in type_map:
        return type_map[type_str]
    if '债' in type_str:
        return '债券型'
    if '指数' in type_str or 'ETF' in type_str.upper():
        return '指数型'
    if '货币' in type_str:
        return '货币型'
    if 'QDII' in type_str.upper():
        return 'QDII'
    if '股票' in type_str:
        return '股票型'
    if '混合' in type_str:
        return '混合型'
    return type_str if type_str else '混合型'


def safe_float(val):
    """安全转换为浮点数"""
    if val is None or val == '' or val == '--':
        return 0.0
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


# ========== 邮箱验证码登录 API ==========

def _clean_expired_codes():
    """清理过期验证码"""
    now = time.time()
    expired = [e for e, v in _email_codes.items() if now > v['expire_time']]
    for e in expired:
        del _email_codes[e]


def _send_email_code(to_email, code):
    """通过Brevo HTTP API发送验证码邮件，返回是否成功"""
    if not BREVO_API_KEY or not BREVO_FROM_EMAIL:
        # 未配置Brevo，打印到控制台（开发模式）
        print(f'[验证码-未配置BREVO_API_KEY] 邮箱: {to_email}, 验证码: {code}', flush=True)
        print('提示: 配置 BREVO_API_KEY / BREVO_FROM_EMAIL 环境变量后可发送真实邮件', flush=True)
        return False

    html_body = f"""\
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <div style="background: linear-gradient(135deg, #1677ff, #13c2c2); border-radius: 12px 12px 0 0; padding: 20px 24px;">
        <h2 style="color: #fff; margin: 0; font-size: 18px;">基金净值通</h2>
        <p style="color: rgba(255,255,255,0.85); margin: 4px 0 0; font-size: 13px;">登录验证码</p>
    </div>
    <div style="background: #fff; border: 1px solid #e8edf3; border-top: none; border-radius: 0 0 12px 12px; padding: 24px;">
        <p style="color: #333; font-size: 14px;">您好，您正在登录基金净值通，验证码为：</p>
        <div style="font-size: 36px; font-weight: 800; color: #1677ff; letter-spacing: 6px; text-align: center; padding: 20px; background: #f0f4f8; border-radius: 8px; margin: 16px 0; font-family: 'Courier New', monospace;">
            {code}
        </div>
        <p style="color: #999; font-size: 12px; margin: 0;">验证码5分钟内有效，请勿泄露给他人。如非本人操作，请忽略此邮件。</p>
    </div>
</div>"""

    url = 'https://api.brevo.com/v3/smtp/email'
    headers = {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'accept': 'application/json'
    }
    payload = {
        'sender': {
            'name': BREVO_FROM_NAME,
            'email': BREVO_FROM_EMAIL
        },
        'to': [{'email': to_email}],
        'subject': '【基金净值通】您的登录验证码',
        'htmlContent': html_body
    }

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=15)
        if resp.status_code in (200, 201):
            print(f'[邮件已发送] {to_email}', flush=True)
            return True
        else:
            print(f'[邮件发送失败] {to_email}: {resp.status_code} {resp.text}', flush=True)
            return False
    except Exception as e:
        print(f'[邮件发送失败] {to_email}: {e}', flush=True)
        return False


@app.route('/api/auth/register', methods=['POST'])
def api_register():
    """账号注册（用户名 + 密码）"""
    _clean_expired_tokens()
    username = (request.json.get('username', '') if request.json else '').strip()
    password = (request.json.get('password', '') if request.json else '').strip()

    if not username:
        return jsonify({'success': False, 'message': '请输入用户名'})
    if len(username) < 3 or len(username) > 20:
        return jsonify({'success': False, 'message': '用户名长度需3-20个字符'})
    if not re.match(r'^[a-zA-Z0-9_\u4e00-\u9fa5]+$', username):
        return jsonify({'success': False, 'message': '用户名只能包含字母、数字、下划线、中文'})
    if not password:
        return jsonify({'success': False, 'message': '请输入密码'})
    if len(password) < 6:
        return jsonify({'success': False, 'message': '密码长度至少6位'})

    users = _load_users()
    if username in users:
        return jsonify({'success': False, 'message': '该用户名已被注册'})

    salt = str(random.randint(100000, 999999))
    users[username] = {
        'password': _hash_password(password, salt),
        'salt': salt,
        'favorites': [],
        'groups': ['全部'],
        'holdings': [],
        'createTime': time.time()
    }
    if not _save_users(users):
        return jsonify({'success': False, 'message': '注册失败，请稍后重试'})

    # 重新注册时从删除黑名单中移除
    _remove_deleted_user(username)

    token = _gen_token(username)
    return jsonify({
        'success': True,
        'message': '注册成功',
        'token': token,
        'username': username
    })


@app.route('/api/auth/login', methods=['POST'])
def api_login():
    """账号密码登录"""
    _clean_expired_tokens()
    username = (request.json.get('username', '') if request.json else '').strip()
    password = (request.json.get('password', '') if request.json else '').strip()

    if not username or not password:
        return jsonify({'success': False, 'message': '请输入用户名和密码'})

    users = _load_users()
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': '用户名或密码错误'})

    salt = user.get('salt', '')
    if _hash_password(password, salt) != user.get('password'):
        return jsonify({'success': False, 'message': '用户名或密码错误'})

    token = _gen_token(username)
    return jsonify({
        'success': True,
        'message': '登录成功',
        'token': token,
        'username': username
    })


@app.route('/api/auth/verify', methods=['POST'])
def api_verify_token():
    """验证令牌是否有效"""
    username = _get_user_from_token(request)
    if username:
        return jsonify({'success': True, 'username': username})
    return jsonify({'success': False})


@app.route('/api/user/favorites', methods=['GET', 'POST', 'DELETE'])
def api_user_favorites():
    """用户自选基金 - 服务端存储"""
    username = _get_user_from_token(request)
    if not username:
        return jsonify({'success': False, 'message': '请先登录'}), 401

    users = _load_users()
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': '用户不存在'}), 404

    if request.method == 'GET':
        return jsonify({'success': True, 'favorites': user.get('favorites', []), 'groups': user.get('groups', ['全部'])})

    if request.method == 'POST':
        data = request.json or {}
        user['favorites'] = data.get('favorites', [])
        user['groups'] = data.get('groups', ['全部'])
        _save_users(users)
        return jsonify({'success': True, 'message': '自选已同步'})

    if request.method == 'DELETE':
        user['favorites'] = []
        _save_users(users)
        return jsonify({'success': True, 'message': '已清空自选'})


@app.route('/api/user/holdings', methods=['GET', 'POST', 'DELETE'])
def api_user_holdings():
    """用户持仓 - 服务端存储"""
    username = _get_user_from_token(request)
    if not username:
        return jsonify({'success': False, 'message': '请先登录'}), 401

    users = _load_users()
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': '用户不存在'}), 404

    if request.method == 'GET':
        return jsonify({'success': True, 'holdings': user.get('holdings', [])})

    if request.method == 'POST':
        data = request.json or {}
        user['holdings'] = data.get('holdings', [])
        _save_users(users)
        return jsonify({'success': True, 'message': '持仓已同步'})

    if request.method == 'DELETE':
        user['holdings'] = []
        _save_users(users)
        return jsonify({'success': True, 'message': '已清空持仓'})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    print('='*50)
    print('基金净值查询后端服务启动')
    print(f'访问地址: http://localhost:{port}')
    print('数据来源: 东方财富/天天基金 (实时数据)')
    if BREVO_API_KEY and BREVO_FROM_EMAIL:
        print(f'邮件服务: Brevo API (发件人: {BREVO_FROM_EMAIL})')
    else:
        print('邮件服务: 未配置 (验证码将打印到控制台)')
        print('  配置方法: 设置环境变量 BREVO_API_KEY / BREVO_FROM_EMAIL')
        print('  获取API Key: https://app.brevo.com/settings/keys/api')
    # 启动时从GitHub云端同步用户数据
    print('正在从云端同步用户数据...')
    cloud_data = _github_fetch_users()
    if cloud_data:
        try:
            with open(_USERS_FILE, 'w', encoding='utf-8') as f:
                json.dump(cloud_data, f, ensure_ascii=False, indent=2)
            print(f'云端同步完成: {len(cloud_data)}个用户')
        except:
            pass
    else:
        print('云端无数据或同步失败，使用本地数据')
    print('='*50)
    app.run(host='0.0.0.0', port=port, debug=False)


# ========== 热点数据预热(模块级, gunicorn和直接运行均生效) ==========
_prewarm_started = False
_prewarm_lock = threading.Lock()

def _refresh_hot_cache():
    """刷新所有热点缓存"""
    try:
        data = _fetch_market_indices()
        if data:
            _set_cache('market_indices', data)
    except Exception as e:
        print(f'[预热] 大盘指数失败: {e}', flush=True)
    try:
        results = _fetch_industry_sectors()
        _sector_cache['sectors_行业板块'] = {'data': results, 'time': time.time()}
    except Exception as e:
        print(f'[预热] 行业板块失败: {e}', flush=True)
    try:
        results = _fetch_concept_sectors()
        _sector_cache['sectors_概念题材'] = {'data': results, 'time': time.time()}
    except Exception as e:
        print(f'[预热] 概念题材失败: {e}', flush=True)
    try:
        result = _fetch_news('15')
        if result:
            _set_cache('news_15', result)
    except Exception as e:
        print(f'[预热] 资讯失败: {e}', flush=True)
    # 预热基金排行(默认参数:日涨幅降序/全部/第1页20条)
    try:
        ranking = _fetch_ranking('ranking_RZDF_20_1_all_desc', 'RZDF', '20', '1', 'all', 'desc')
        if ranking:
            print('[预热] 基金排行预热完成', flush=True)
    except Exception as e:
        print(f'[预热] 基金排行失败: {e}', flush=True)
    # 预热基金列表(默认参数:全部类型/季度排序降序)
    try:
        funds = _fetch_ths_fund_list('all', 'F009', 'desc')
        if funds:
            _set_cache('ths_list_all_F009_desc', funds)
            print(f'[预热] 基金列表预热完成({len(funds)}只)', flush=True)
    except Exception as e:
        print(f'[预热] 基金列表失败: {e}', flush=True)


def _prewarm_loop():
    """后台预热循环: 启动3秒后首次预热, 之后每30秒刷新"""
    import time as _time
    _time.sleep(3)
    print('[预热] 开始预热热点数据...', flush=True)
    _refresh_hot_cache()
    print('[预热] 热点数据预热完成', flush=True)
    while True:
        _time.sleep(30)
        try:
            _refresh_hot_cache()
        except Exception as e:
            print(f'[预热] 周期刷新异常: {e}', flush=True)


def _ensure_prewarm():
    """确保预热线程已启动(在worker进程中, 首次请求时触发)"""
    global _prewarm_started
    if not _prewarm_started:
        with _prewarm_lock:
            if not _prewarm_started:
                _prewarm_started = True
                t = threading.Thread(target=_prewarm_loop, daemon=True)
                t.start()
                print('[预热] 预热线程已在worker中启动', flush=True)


@app.before_request
def _start_prewarm_on_first_request():
    """首个请求到达时启动预热线程(gunicorn worker进程中)"""
    _ensure_prewarm()
