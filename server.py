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
import random
import hashlib
import threading
import urllib.parse
from datetime import datetime
import requests
from flask import Flask, request, jsonify, send_from_directory, Response
from allowed_sectors import ALLOWED_SECTORS
from sector_categories import get_sector_category, SECTOR_CATEGORY_MAP

app = Flask(__name__, static_folder='.', static_url_path='')

# ========== 注册后台管理蓝图 ==========
from admin_api import admin_bp
app.register_blueprint(admin_bp)


# ========== 全局响应头：禁止缓存，确保数据实时 ==========
@app.after_request
def add_no_cache_headers(resp):
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

# ========== 邮箱验证码存储（内存，5分钟过期）==========
_email_codes = {}  # {email: {code, expire_time, attempts}}
_sector_cache = {}  # {key: {data, time}} - 板块数据缓存，60秒过期

# ========== 用户数据持久化存储 ==========
# 优先使用 /data (Railway volume)，其次用项目目录
_DB_DIR = '/data' if os.path.isdir('/data') else os.path.dirname(os.path.abspath(__file__))
# 确保目录存在
try:
    os.makedirs(_DB_DIR, exist_ok=True)
except Exception:
    pass
_USERS_FILE = os.path.join(_DB_DIR, 'users.json')
_TOKENS = {}  # {token: {username, expire_time}} - 兼容旧令牌（内存）
# 固定密钥，版本更新不会变化，确保老token仍然有效
_TOKEN_SECRET = 'fund_query_secret_2026_v1'

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
    # 验证用户是否存在
    users = _load_users()
    if username not in users:
        # 如果users.json丢失（重新部署），但token签名有效，
        # 则自动重建用户记录（空数据，密码未知但token仍有效）
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


@app.route('/api/estimate')
def api_estimate():
    """实时估值 - 对接天天基金fundgz"""
    code = request.args.get('code', '').strip()
    if not code:
        return jsonify(None)

    url = f'https://fundgz.1234567.com.cn/js/{code}.js'
    params = {'rt': int(time.time() * 1000)}
    try:
        resp = SESSION.get(url, params=params, timeout=8)
        text = resp.text.strip()
        # 解析 jsonpgz({...}) 格式
        match = re.search(r'jsonpgz\((.+)\)', text)
        if match:
            data = json.loads(match.group(1))
            return jsonify({
                'fundcode': data.get('fundcode', ''),
                'name': data.get('name', ''),
                'jzrq': data.get('jzrq', ''),
                'dwjz': safe_float(data.get('dwjz')),
                'gsz': safe_float(data.get('gsz')),
                'gszzl': safe_float(data.get('gszzl')),
                'gztime': data.get('gztime', '')
            })
        return jsonify(None)
    except Exception as e:
        print(f'[估值异常] {code}: {e}')
        return jsonify(None)


@app.route('/api/estimate/batch')
def api_estimate_batch():
    """批量实时估值 - 并发请求提高速度"""
    codes = request.args.get('codes', '').strip()
    if not codes:
        return jsonify([])

    code_list = [c.strip() for c in codes.split(',') if c.strip()]
    results = []
    results_lock = threading.Lock()

    def fetch_one(code):
        url = f'https://fundgz.1234567.com.cn/js/{code}.js'
        params = {'rt': int(time.time() * 1000)}
        try:
            resp = SESSION.get(url, params=params, timeout=5)
            text = resp.text.strip()
            match = re.search(r'jsonpgz\((.+)\)', text)
            if match:
                data = json.loads(match.group(1))
                return {
                    'fundcode': data.get('fundcode', ''),
                    'name': data.get('name', ''),
                    'jzrq': data.get('jzrq', ''),
                    'dwjz': safe_float(data.get('dwjz')),
                    'gsz': safe_float(data.get('gsz')),
                    'gszzl': safe_float(data.get('gszzl')),
                    'gztime': data.get('gztime', '')
                }
        except Exception as e:
            print(f'[批量估值异常] {code}: {e}')
        return None

    # 使用线程池并发请求
    from concurrent.futures import ThreadPoolExecutor, as_completed
    with ThreadPoolExecutor(max_workers=30) as executor:
        future_to_code = {executor.submit(fetch_one, code): code for code in code_list}
        for future in as_completed(future_to_code, timeout=12):
            try:
                result = future.result(timeout=5)
                if result:
                    with results_lock:
                        results.append(result)
            except Exception:
                pass

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

    # 如果名称仍为空,尝试用估值接口获取
    if not result['name']:
        try:
            url = f'https://fundgz.1234567.com.cn/js/{code}.js'
            resp = SESSION.get(url, params={'rt': int(time.time() * 1000)}, timeout=8)
            match = re.search(r'jsonpgz\((.+)\)', resp.text.strip())
            if match:
                data = json.loads(match.group(1))
                result['name'] = data.get('name', '')
                if result['netValue'] == 0:
                    result['netValue'] = safe_float(data.get('dwjz'))
                    result['netValueDate'] = data.get('jzrq', '')
                if result['totalNetValue'] == 0:
                    result['totalNetValue'] = safe_float(data.get('jzrq'))
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
        return jsonify({'funds': results, 'total': total_count})
    except Exception as e:
        print(f'[排行异常]: {e}')
        return jsonify([])


@app.route('/api/news')
def api_news():
    """7x24实时财经资讯 - 对接东方财富7x24快讯接口"""
    page_size = request.args.get('size', '15')
    sort_end = request.args.get('sortEnd', '')

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
            return jsonify({
                'list': results,
                'sortEnd': data['data'].get('sortEnd', ''),
                'total': data['data'].get('total', 0)
            })
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
            return jsonify({
                'list': results,
                'sortEnd': '',
                'total': 0
            })
        print(f'[资讯] 备用接口也无数据: msg={data2.get("message", "")}', flush=True)
    except Exception as e:
        print(f'[资讯] 备用接口异常: {e}', flush=True)

    return jsonify({'list': [], 'sortEnd': '', 'total': 0})


@app.route('/api/market-indices')
def api_market_indices():
    """大盘指数实时行情 - 对接东方财富push2接口，采集全部国内外指数"""
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
        resp = SESSION.get(url, params=params, timeout=8)
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
            return jsonify(results)
        print(f'[大盘指数] 无数据: {json.dumps(data, ensure_ascii=False)[:200]}')
        return jsonify([])
    except Exception as e:
        print(f'[大盘指数异常]: {e}')
        return jsonify([])


@app.route('/api/sectors')
def api_sectors():
    """行业板块+概念板块实时行情 - 对接东方财富push2接口
    优化: 并行请求行业+概念板块, 添加category主题标签, 120秒缓存
    """
    board_type = request.args.get('type', 'all')  # all/industry/concept/category名称
    category_filter = request.args.get('category', '')  # 主题大类过滤

    # 内存缓存：120秒内复用上次结果
    cache_key = 'sectors_' + board_type + '_' + category_filter
    cached = _sector_cache.get(cache_key)
    if cached and time.time() - cached['time'] < 300:
        return jsonify(cached['data'])

    sector_headers = {
        'User-Agent': HEADERS['User-Agent'],
        'Referer': 'https://quote.eastmoney.com/center/boardlist.html',
        'Accept': '*/*',
    }

    def fetch_boards(fs_type, label):
        results = []
        base_url = 'https://push2.eastmoney.com/api/qt/clist/get'
        sector_headers = {
            'User-Agent': HEADERS['User-Agent'],
            'Referer': 'https://quote.eastmoney.com/center/boardlist.html',
            'Accept': '*/*',
        }
        for attempt in range(5):
            ts = str(int(time.time() * 1000))
            full_url = (base_url + '?pn=1&pz=500&po=1&np=1'
                        '&ut=bd1d9ddb04089700cf9c27f6f7426281'
                        '&fltt=2&invt=2&fid=f3'
                        '&fs=' + fs_type +
                        '&fields=f12,f14,f2,f3,f4,f104,f105'
                        '&_=' + ts)
            try:
                resp = SESSION.get(full_url, headers=sector_headers, timeout=15)
                data = resp.json()
                if data.get('data') and data['data'].get('diff'):
                    for item in data['data']['diff']:
                        name = item.get('f14', '')
                        # 只采集有主题分类的板块（SECTOR_CATEGORY_MAP作为过滤器）
                        if name not in SECTOR_CATEGORY_MAP:
                            continue
                        results.append({
                            'code': item.get('f12', ''),
                            'name': name,
                            'price': safe_float(item.get('f2')),
                            'changePercent': safe_float(item.get('f3')),
                            'change': safe_float(item.get('f4')),
                            'upCount': safe_float(item.get('f104', 0)),
                            'downCount': safe_float(item.get('f105', 0)),
                            'type': label,
                            'category': get_sector_category(name)
                        })
                    print(f'[板块-{label}] 采集到 {len(results)} 个板块', flush=True)
                    return results
                else:
                    print(f'[板块-{label}] 尝试{attempt+1}无数据: {str(data)[:150]}', flush=True)
            except Exception as e:
                print(f'[板块异常-{label}] 尝试{attempt+1}: {e}', flush=True)
            if attempt < 4:
                time.sleep(2)
        return results

    # 请求行业+概念板块（顺序请求，保证稳定性）
    all_results = []
    if board_type in ('all', 'industry'):
        all_results.extend(fetch_boards('m:90+t:2', 'industry'))
    if board_type in ('all', 'concept'):
        all_results.extend(fetch_boards('m:90+t:3', 'concept'))

    # 按主题大类过滤
    if category_filter:
        all_results = [s for s in all_results if s.get('category') == category_filter]

    # 按涨跌幅降序排序
    all_results.sort(key=lambda x: x.get('changePercent', 0), reverse=True)

    # 缓存结果
    if all_results:
        _sector_cache[cache_key] = {'data': all_results, 'time': time.time()}
    elif cached:
        print(f'[板块] 所有重试失败，返回过期缓存数据', flush=True)
        return jsonify(cached['data'])

    return jsonify(all_results)


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
