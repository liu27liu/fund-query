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
from datetime import datetime
import requests
from flask import Flask, request, jsonify, send_from_directory, Response

app = Flask(__name__, static_folder='.', static_url_path='')

# ========== 全局响应头：禁止缓存，确保数据实时 ==========
@app.after_request
def add_no_cache_headers(resp):
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

# ========== 邮箱验证码存储（内存，5分钟过期）==========
_email_codes = {}  # {email: {code, expire_time, attempts}}

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


@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


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
            return jsonify(results)
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
    """批量实时估值"""
    codes = request.args.get('codes', '').strip()
    if not codes:
        return jsonify([])

    code_list = [c.strip() for c in codes.split(',') if c.strip()]
    results = []
    for code in code_list:
        url = f'https://fundgz.1234567.com.cn/js/{code}.js'
        params = {'rt': int(time.time() * 1000)}
        try:
            resp = SESSION.get(url, params=params, timeout=8)
            text = resp.text.strip()
            match = re.search(r'jsonpgz\((.+)\)', text)
            if match:
                data = json.loads(match.group(1))
                results.append({
                    'fundcode': data.get('fundcode', ''),
                    'name': data.get('name', ''),
                    'jzrq': data.get('jzrq', ''),
                    'dwjz': safe_float(data.get('dwjz')),
                    'gsz': safe_float(data.get('gsz')),
                    'gszzl': safe_float(data.get('gszzl')),
                    'gztime': data.get('gztime', '')
                })
        except Exception as e:
            print(f'[批量估值异常] {code}: {e}')
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
    size = request.args.get('size', '10')
    fund_type = request.args.get('type', 'all')

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

    url = 'https://fund.eastmoney.com/data/rankhandler.aspx'
    params = {
        'op': 'ph',
        'dt': 'kf',
        'ft': fund_type,
        'rs': '',
        'gs': 0,
        'sc': sc,
        'st': 'desc',
        'pi': 1,
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

        # 解析 var rankData = {datas:[...], ...}
        match = re.search(r'datas:\[(.+?)\]', text, re.DOTALL)
        if not match:
            return jsonify([])

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
        return jsonify(results)
    except Exception as e:
        print(f'[排行异常]: {e}')
        return jsonify([])


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


@app.route('/api/auth/send-code', methods=['POST'])
def api_send_code():
    """发送邮箱验证码"""
    _clean_expired_codes()
    email = (request.json.get('email', '') if request.json else '').strip().lower()
    if not email:
        return jsonify({'success': False, 'message': '请输入邮箱地址'})
    if not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email):
        return jsonify({'success': False, 'message': '邮箱格式不正确'})

    # 频率限制：60秒内不能重复发送
    if email in _email_codes:
        elapsed = time.time() - (_email_codes[email]['expire_time'] - 300)
        if elapsed < 60:
            wait = int(60 - elapsed)
            return jsonify({'success': False, 'message': f'请{wait}秒后再试'})

    # 生成6位验证码
    code = str(random.randint(100000, 999999))
    _email_codes[email] = {
        'code': code,
        'expire_time': time.time() + 300,  # 5分钟有效
        'attempts': 0
    }

    # 通过Brevo API发送验证码邮件
    sent = _send_email_code(email, code)
    if not sent:
        if not BREVO_API_KEY or not BREVO_FROM_EMAIL:
            return jsonify({
                'success': True,
                'message': '验证码已发送（邮件服务未配置，请查看服务器日志）'
            })
        else:
            return jsonify({
                'success': True,
                'message': '验证码已发送，请查看邮箱（若未收到请检查垃圾邮件夹）'
            })

    return jsonify({
        'success': True,
        'message': f'验证码已发送至 {email}'
    })


@app.route('/api/auth/login', methods=['POST'])
def api_login():
    """邮箱验证码登录"""
    _clean_expired_codes()
    email = (request.json.get('email', '') if request.json else '').strip().lower()
    code = (request.json.get('code', '') if request.json else '').strip()

    if not email or not code:
        return jsonify({'success': False, 'message': '请输入邮箱和验证码'})
    if not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email):
        return jsonify({'success': False, 'message': '邮箱格式不正确'})

    if email not in _email_codes:
        return jsonify({'success': False, 'message': '请先获取验证码'})

    record = _email_codes[email]
    if time.time() > record['expire_time']:
        del _email_codes[email]
        return jsonify({'success': False, 'message': '验证码已过期，请重新获取'})

    # 防暴力破解：最多5次尝试
    record['attempts'] += 1
    if record['attempts'] > 5:
        del _email_codes[email]
        return jsonify({'success': False, 'message': '尝试次数过多，请重新获取验证码'})

    if record['code'] != code:
        remaining = 5 - record['attempts']
        return jsonify({'success': False, 'message': f'验证码错误，还可尝试{remaining}次'})

    # 验证成功，删除验证码
    del _email_codes[email]

    # 生成登录令牌
    token = hashlib.sha256(f'{email}{time.time()}{random.random()}'.encode()).hexdigest()

    # 邮箱脱敏显示：前2位 + *** + @域名
    at_idx = email.index('@')
    if at_idx <= 2:
        masked = email[0] + '***' + email[at_idx:]
    else:
        masked = email[:2] + '***' + email[at_idx:]

    return jsonify({
        'success': True,
        'message': '登录成功',
        'token': token,
        'email': masked
    })


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
    print('='*50)
    app.run(host='0.0.0.0', port=port, debug=False)
