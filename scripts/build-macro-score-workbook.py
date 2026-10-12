#!/usr/bin/env python3
"""Build an auditable, blank macro scorecard from the user's workbook.

The source workbook is read-only. The output is a separate proposal and does not
contain current-period observations or claim an official macro rating.
"""

from __future__ import annotations

from copy import copy
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.formatting.rule import CellIsRule, ColorScaleRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation


SOURCE = Path('/Users/xionglinpeng/Desktop/中国宏观分析框架.xlsx')
OUTPUT = Path(__file__).resolve().parents[1] / 'deliverables' / '中国宏观评级评分框架_定量核心指标完善版.xlsx'
BURGUNDY = '72252A'
GOLD = 'B88B50'
CREAM = 'F6F1EA'
PALE = 'FBF8F4'
INK = '282B2D'
MUTED = '62666A'
GREEN = 'E4F0E8'
RED = 'F8E6E6'

SOURCE_NAMES = {
    'GDP同比增速（%）', 'CPI同比（%）', '核心CPI同比（%）', 'PPI同比（%）',
    '城镇调查失业率（%）', '综合PMI产出指数', '规模以上工业增加值增速（%）',
    '工业企业利润总额增速（%）', '商品房销售面积增速（%）',
    '房屋新开工面积增速（%）', '房地产开发企业资金来源增速（%）',
    '固定资产投资（FAI）增速（%）', '制造业投资增速（%）',
    '民间固定资产投资增速（%）', '社会消费品零售总额增速（%）',
    '出口金额增速（美元计，%）', '社融规模存量增速（%）',
    '人民币贷款存量增速（%）', 'M1-M2剪刀差',
}
DERIVED_SOURCE = {
    '居民户中长期贷款增量（亿元）': '核心原料：派生近3月同比多增',
    '非金融企业中长期贷款增量（亿元）': '核心原料：派生近3月同比多增',
}
RATIONALES = {
    'GDP总量（亿元）': '规模随时间自然扩张，固定绝对值阈值不适合评级',
    'GDP环比增速（%）': '用于拐点验证；与GDP同比重复计分且季调值会修订',
    'GDP平减指数': '重要但需同口径名义/实际GDP计算，先作价格验证',
    'CPI环比（%）': '季节性较强，用来解释同比变化，不另计分',
    'PPI环比（%）': '用于价格拐点，和PPI同比不重复计分',
    '外汇储备（亿美元）': '绝对规模受估值影响，不宜按固定警戒线打分',
    '美元兑人民币汇率': '汇率点位不能简单定义好坏，观察变动和波动',
    'CFETS人民币汇率指数': '侧重稳定性与外部约束，原表无完整五档',
    '货物贸易顺差（亿美元）': '绝对额受规模、季节性影响；与贸易差额重复',
    '贸易差额（亿美元）': '和货物贸易顺差重复，不双计',
    '服务贸易差额（亿美元）': '绝对额和季节性影响较大，原表五档不全',
    '制造业PMI（%）': '保留作结构分解，综合PMI承担主要景气得分',
    '非制造业PMI（%）': '保留作结构分解，综合PMI承担主要景气得分',
    'BCI中国企业经营状况指数': '非官方样本，辅助交叉核验，不作为主要评分',
    '发电量增速（%）': '受天气及能源结构变化影响，辅助验证工业生产',
    '铁路货运量增速（%）': '受运输结构变化影响，不单独等权计分',
    '商品房销售额增速（%）': '与销售面积高度相关，辅助拆分量价',
    '房屋竣工面积增速（%）': '反映交付，与销售/新开工并列观察，不重复计分',
    '房地产开发企业土地购置面积增速（%）': '历史可比性与政策结构变化需核准',
    '70个大中城市新建商品住宅价格指数（%）': '必须先区分环比/同比及城市加权，不能共用一条阈值',
    '国房景气指数': '合成指标与地产分项重复，保留综合复核',
    '基建投资增速（%）': '观察财政传导，避免将政策支出直接当作内生需求',
    '房地产开发投资增速（%）': '地产链已有销售、新开工和资金来源计分',
    '高技术产业投资增速（%）': '结构性方向重要，但不宜用高增速机械推高总量评级',
    '进口金额增速（美元计，%）': '受价格和汇率影响较大，辅助需求验证',
    '出口集装箱运价指数（CCFI）': '运价受供给扰动影响，原表五档不完整',
    '居民户短期贷款增量（亿元）': '信贷月度扰动大且可受消费贷政策影响，辅助观察',
    '非金融企业短期贷款增量（亿元）': '短贷可能替代票据/长贷，辅助观察结构',
    'M0增速（%）': '现金需求受支付方式与春节错位影响，不单独计分',
    'M1增速（%）': '用于分析资金活化；避免与剪刀差重复计分，注意2025口径调整',
    'M2增速（%）': '不能把越快视为越健康；和M1剪刀差联动观察',
}


def core(id_, pillar, group, name, frequency, unit, source, within, mode,
         limits, note, definition='原发布口径'):
    return dict(id=id_, pillar=pillar, group=group, name=name,
                frequency=frequency, unit=unit, source=source, within=within,
                mode=mode, limits=limits, note=note, definition=definition)


# All thresholds are research proposals, NOT official standards. They require
# historical backtesting, policy-target review, and a versioned approval.
CORE = [
    core('E01','经济运行','经济增长','GDP同比增速（%）','季度','%','国家统计局',.30,'高优',[3,4,5,6], '年度增长目标变化时重审阈值；初步核算及修订分开留档','不变价、当季/累计口径需固定'),
    core('E02','经济运行','物价水平','CPI同比（%）','月度','%','国家统计局',.12,'目标',[0,4.5,.5,3.5,1,3,1.5,2.5], '过低和过高都扣分；季节因素看环比辅助'),
    core('E03','经济运行','物价水平','核心CPI同比（%）','月度','%','国家统计局',.10,'目标',[0,4,.5,3.5,1,3,1.5,2.5], '扣除食品和能源，观察内需价格'),
    core('E04','经济运行','物价水平','PPI同比（%）','月度','%','国家统计局',.08,'目标',[-3,8,-2,6,-1,4,0,3], '极端高增可能来自成本冲击，不再机械给5分'),
    core('E05','经济运行','就业市场','城镇调查失业率（%）','月度','%','国家统计局',.20,'低优',[4.5,5,5.5,6], '配合就业质量、青年失业率观察；单一指标有限'),
    core('E06','经济运行','景气指数','综合PMI产出指数','月度','指数点','国家统计局',.20,'高优',[48,50,52,54], '制造业和非制造业PMI保留作结构解释'),
    core('G01','增长动力','工业生产','规模以上工业增加值增速（%）','月度','%','国家统计局',.12,'高优',[3,5,6,8], '固定当月同比口径，1—2月合并发布'),
    core('G02','增长动力','工业生产','工业企业利润总额增速（%）','月度','%','国家统计局',.08,'高优',[-10,0,8,15], '官方多为年初累计同比，勿误写当月同比','年初累计同比'),
    core('G03','增长动力','房地产','商品房销售面积增速（%）','月度','%','国家统计局',.10,'高优',[-20,-10,0,5], '固定年初累计同比，不与单月增量混用','年初累计同比'),
    core('G04','增长动力','房地产','房屋新开工面积增速（%）','月度','%','国家统计局',.04,'高优',[-25,-10,0,10], '固定年初累计同比','年初累计同比'),
    core('G05','增长动力','房地产','房地产开发企业资金来源增速（%）','月度','%','国家统计局',.06,'高优',[-15,-5,0,10], '固定年初累计同比','年初累计同比'),
    core('G06','增长动力','投资','固定资产投资（FAI）增速（%）','月度','%','国家统计局',.05,'高优',[2,4,6,8], '不含农户；固定年初累计同比','年初累计同比'),
    core('G07','增长动力','投资','制造业投资增速（%）','月度','%','国家统计局',.10,'高优',[4,7,10,14], '不含农户；固定年初累计同比','年初累计同比'),
    core('G08','增长动力','投资','民间固定资产投资增速（%）','月度','%','国家统计局',.10,'高优',[2,4,6,9], '不含农户；固定年初累计同比','年初累计同比'),
    core('G09','增长动力','消费','社会消费品零售总额增速（%）','月度','%','国家统计局',.25,'高优',[2,4,6,8], '固定当月名义同比；服务零售辅助验证','当月名义同比'),
    core('G10','增长动力','进出口','出口金额增速（美元计，%）','月度','%','海关总署',.10,'高优',[-5,0,5,10], '固定美元计同比；人民币计与价格拆分辅助','美元计当月同比'),
    core('F01','金融信贷','信贷结构','居民中长期贷款近3月同比多增（亿元）','月度','亿元','中国人民银行',.15,'高优',[-3000,-1500,0,1500], '由三个月当月新增之和减上年对应三个月；春节错位需特别解释','派生：近3月同比多增'),
    core('F02','金融信贷','信贷结构','企业中长期贷款近3月同比多增（亿元）','月度','亿元','中国人民银行',.20,'高优',[-5000,-2500,0,2500], '企事业单位口径须与原表核对；不得仅用累计值伪装当月','派生：近3月同比多增'),
    core('F03','金融信贷','社会融资','社融规模存量增速（%）','月度','%','中国人民银行',.25,'高优',[7,8.5,10,12], '存量期末同比；注意历史统计范围变化','期末同比'),
    core('F04','金融信贷','社会融资','人民币贷款存量增速（%）','月度','%','中国人民银行',.15,'高优',[7,9,11,13], '与社融存量增速信息重叠，权重已下调；核清金融机构/社融口径','期末同比'),
    core('F05','金融信贷','货币供给','M1-M2剪刀差','月度','百分点','中国人民银行',.25,'目标',[-10,12,-5,8,-2,5,0,3], 'M1同比减M2同比；新旧M1口径不能直接连成同一评级序列','新口径M1同比−同月M2同比'),
]

# These four rows are scored through verified policy actions in sheet 06.
# Listing all five anchors here lets the core scorecard be audited in one view.
POLICY_CORE = [
    ('P01','财政政策','财政逆周期动作强度',.30,'全国人大、财政部',
     '量化：新增财政融资工具/GDP同比变动（40%）＋预算支出执行进度同比变动（35%）＋新增专项债发行进度同比变动（25%）；见下方子项。仅衡量政策动作；预算口径及债务约束须披露。',
     ('两项量化子指标加权接近1分：财政明显收缩',
      '两项量化子指标加权接近2分：财政温和收缩',
      '两项量化子指标加权接近3分：财政大体中性',
      '两项量化子指标加权接近4分：财政温和扩张',
      '两项量化子指标加权接近5分：财政明显扩张；不等于效果已兑现')),
    ('P02','货币政策','货币逆周期动作强度',.30,'中国人民银行',
     '量化：近6月7天逆回购政策利率变动（45%）＋存款准备金率变动（35%）＋结构性工具近3月净投放/GDP（20%）；见下方子项。负利率/降准变动为宽松，0须正式核实。',
     ('两项量化子指标加权接近1分：货币明显收紧',
      '两项量化子指标加权接近2分：货币温和收紧',
      '两项量化子指标加权接近3分：货币大体中性',
      '两项量化子指标加权接近4分：货币温和宽松',
      '两项量化子指标加权接近5分：货币明显宽松；不等于信用已改善')),
    ('P03','产业政策','产业政策方向与工具',.20,'国务院、国家发展改革委、工业和信息化部等',
     '逐篇核对正式原文：政策方向、覆盖范围、工具/资源、明确时点；供给侧出清和新兴产业支持均可计入，但同时记录受益及受损行业。',
     ('正式政策总体撤回支持或显著抑制有效供给/竞争',
      '政策方向偏约束，或支持范围极窄、缺乏具体工具',
      '有正式方向但无具体措施，或正负影响大体抵消',
      '正式细则、资源/试点/标准和适用范围明确',
      '跨部门政策组合、资金/标准/试点和时间表明确；无需等待订单兑现')),
    ('P04','制度建设','制度建设方向与规则',.20,'全国人大、国务院及相关监管部门',
     '逐篇核对法律法规、国务院/监管部门正式原文：市场准入、产权与竞争、要素配置、监管可预期性；记录时点和适用范围。',
     ('正式制度变化显著削弱市场准入、产权或规则稳定性',
      '方向偏限制或不确定性增加，细则不足',
      '正式改革方向已提出但机制与生效安排不明，或正负影响抵消',
      '明确的法律/制度文本、实施细则和生效时点',
      '多项关键制度的规则、责任机构及落地时间表明确；无需等待企业盈利兑现')),
]

# Policy-action metrics are first-class core rules. Category rows summarize
# them, but only metric rows carry fiscal/monetary total weights, preventing
# a category and its components from being counted twice.
POLICY_METRICS = [
    ('P01A','财政政策','新增财政融资工具占GDP比重同比变动','当年正式批准的赤字融资＋新增地方专项债＋特别国债等不重叠额度，除以上年已公布名义GDP；减上年额度/再上年GDP，避免用尚未公布的当年GDP','年度预算／月度复核','百分点','全国人大、财政部','高优',[-1,-.25,.25,1],.40),
    ('P01B','财政政策','一般公共预算支出执行进度同比变动','截至本月累计支出/当年批准预算支出，减上年同月累计支出/上年批准预算支出；年初月度季节性单列说明','月度','百分点','财政部','高优',[-10,-3,3,10],.35),
    ('P01C','财政政策','新增地方专项债发行进度同比变动','截至本月新增专项债累计发行额/当年正式批准新增额度，减上年同月累计发行额/上年批准额度；不含再融资债','月度','百分点','财政部','高优',[-15,-5,5,15],.25),
    ('P02A','货币政策','7天逆回购政策利率近6个月变动','本期央行7天逆回购政策利率减6个月前同政策利率；已正式公布的调整计入，不用LPR或DR007替代','事件驱动／月度复核','基点','中国人民银行','低优',[-30,-10,10,30],.45),
    ('P02B','货币政策','法定存款准备金率近6个月变动','本期与6个月前同类机构法定准备金率差；分档或定向调整须说明覆盖范围；正式核实未调整时填0','事件驱动／月度复核','基点','中国人民银行','低优',[-100,-50,50,100],.35),
    ('P02C','货币政策','结构性货币政策工具近3月净投放/GDP','央行每月披露的“其他结构性货币政策工具”近3月投放减回笼之和/最近四季名义GDP；核对工具更替和口径变化','月度','占GDP百分比','中国人民银行','高优',[-.1,-.025,.025,.1],.20),
]

ADDITIONS = [
    ('新增候选','经济运行','景气指数','制造业PMI新订单指数','月度','国家统计局','辅助观察','订单领先于生产，帮助识别拐点；先不与综合PMI双计'),
    ('新增候选','经济运行','就业市场','不含在校生16—24岁劳动力失业率','月度','国家统计局','辅助观察','就业结构验证；该序列与旧青年失业率不可直接拼接'),
    ('新增候选','增长动力','消费','服务零售额累计同比','月度','国家统计局','辅助观察','补实物零售之外的服务需求；与社零口径不同'),
    ('新增候选','增长动力','房地产','商品房待售面积','月度','国家统计局','辅助观察','供给库存约束；优先观察同比与去化，不按绝对值评分'),
    ('新增候选','经济运行','国际收支','经常账户差额/GDP','季度','国家外汇管理局','辅助观察','以规模比率替代贸易顺差绝对值；核对统计期和GDP'),
]


def style_header(ws, row, end):
    for cells in ws.iter_rows(min_row=row, max_row=row, max_col=end):
        for cell in cells:
            cell.fill = PatternFill('solid', fgColor=BURGUNDY)
            cell.font = Font(name='PingFang SC', size=10, bold=True, color='FFFFFF')
            cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    ws.row_dimensions[row].height = 30


def style_body(ws, start, end, last_col):
    line = Side(style='hair', color='E5DDD2')
    for row in ws.iter_rows(min_row=start, max_row=end, max_col=last_col):
        for c in row:
            c.fill = PatternFill('solid', fgColor='FFFFFF' if c.row % 2 else PALE)
            c.font = Font(name='PingFang SC', size=10, color=INK)
            c.alignment = Alignment(vertical='center', wrap_text=True)
            c.border = Border(bottom=line)
        ws.row_dimensions[row[0].row].height = 42


def title(ws, text, subtitle, last_col):
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=last_col)
    ws.cell(1, 1, text)
    ws.cell(1, 1).fill = PatternFill('solid', fgColor=BURGUNDY)
    ws.cell(1, 1).font = Font(name='PingFang SC', size=18, bold=True, color='FFFFFF')
    ws.cell(1, 1).alignment = Alignment(vertical='center')
    ws.row_dimensions[1].height = 42
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=last_col)
    ws.cell(2, 1, subtitle)
    ws.cell(2, 1).fill = PatternFill('solid', fgColor=CREAM)
    ws.cell(2, 1).font = Font(name='PingFang SC', size=10, color=MUTED)
    ws.cell(2, 1).alignment = Alignment(vertical='center', wrap_text=True)
    ws.row_dimensions[2].height = 32


def widths(ws, sizes):
    for col, width in sizes.items():
        ws.column_dimensions[col].width = width
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.sheet_properties.tabColor = GOLD


def add_note(ws, r, c, text):
    cell = ws.cell(r, c, text)
    cell.fill = PatternFill('solid', fgColor=CREAM)
    cell.font = Font(name='PingFang SC', size=10, color=BURGUNDY, bold=True)
    cell.alignment = Alignment(vertical='center', wrap_text=True)


def build():
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)
    original = load_workbook(SOURCE, data_only=False, read_only=True)
    wb = Workbook()
    wb.remove(wb.active)

    guide = wb.create_sheet('00_使用说明')
    title(guide, '中国宏观评级框架｜30／30／20／20版', '研究试行版 · 综合宏观环境与后续投资机会 · 不含本期数据 · 原文件及上一版建议稿均不修改', 6)
    guide.append([])
    guide.append(['步骤','使用方式','结果','必要核验','不可做的事','备注'])
    guide_rows = [
        ('1. 审定框架','查看01四支柱权重、03全部核心规则和06政策录入','获得明确的计分口径','历史回测与投资复盘','把试行阈值称作官方标准','总分用于综合宏观与投资环境观察，当前基本面另列'),
        ('2. 取舍指标','02保留原67项并说明核心/辅助/政策证据，03集中列出21项基本面、4个政策类别及6项财政货币核心指标','减少重复计分','核验原始数据的频率和定义','直接删掉原稿历史','辅助指标仍用于解释'),
        ('3. 月度观察','先在05填写信息截止日，再在04录入统计期、发布日期、数值和来源','计算月度观察分及覆盖率','仅使用截止日之前已发布的值','用未来修订值回填当期判断','季度GDP可用当时已发布的最新一期'),
        ('4. 政策评分','财政/货币在06B录入量化政策动作；产业/制度在06逐篇核对原文','形成宏观调控分','必须有官方链接、发布日期、统计期与截至评价日信息','低利率或高赤字水平自动给高分','只衡量逆周期动作，经济效果由前三支柱验证'),
        ('5. 季度定级','看05的基本面分、政策分和四支柱总分','形成未来一季评级','总覆盖85%才给暂定分；全覆盖才正式定级','缺项默认为3分或让余项变更权重','政策权重固定20%，不能临时上调'),
        ('6. 历史留档','定级后将05结果复制为值到08，留截止日与规则版本','可复盘上期变化','保留初值与修订值','用公式链接覆盖旧评级','原稿四表在后面备查'),
    ]
    for x in guide_rows: guide.append(x)
    style_header(guide, 4, 6); style_body(guide, 5, 10, 6)
    add_note(guide, 12, 1, '来源顺序：官方原始发布 → Wind → 财新数据 API。后两级仅在前级无法满足时补充，并保留代码/序列ID、原始发布机构、期数、单位、口径及重叠期核对。')
    guide.merge_cells('A12:F12'); guide.row_dimensions[12].height = 42
    add_note(guide, 14, 1, '30/30/20/20为用户选定的试行权重；子项权重和阈值是研究建议，不是官方评级标准。宏观调控评价动作强度，不等待经济结果兑现；新旧分数不能直接比较，正式使用前须回测。')
    guide.merge_cells('A14:F14'); guide.row_dimensions[14].height = 38
    guide.append([])
    widths(guide, {'A':19,'B':55,'C':30,'D':30,'E':31,'F':29})
    guide.freeze_panes = 'B5'

    weights = wb.create_sheet('01_权重配置')
    title(weights, '四支柱固定权重｜基本面与政策并列', '用户选定30/30/20/20作为本版试行权重；基本面分和政策分单列。与上一版及原稿不同，不可直接比较分数。', 6)
    weights.append(['一级支柱','新版权重','原稿权重','二级结构（支柱内）','纳入方式','理由'])
    weight_rows = [
        ('经济运行',.30,.30,'增长30%；价格30%；就业20%；景气20%','基本面','避免汇率与顺差绝对值压过就业和价格'),
        ('增长动力',.30,.25,'工业20%；地产20%；投资25%；消费25%；出口10%','基本面','提高增长引擎对宏观与投资机会判断的比重'),
        ('金融信贷',.20,.25,'信贷结构35%；社会融资40%；货币供给25%','基本面','保留信用与流动性验证，但比原稿降低5个百分点'),
        ('宏观调控',.20,.20,'财政30%；货币30%；产业20%；制度20%（试行）','政策动作分','评价正式逆周期动作及改革方向；实际效果回前三支柱验证'),
    ]
    for x in weight_rows: weights.append(x)
    style_header(weights,3,6); style_body(weights,4,7,6)
    for r in range(4,8):
        for c in (2,3): weights.cell(r,c).number_format='0.00%'
    weights['A9']='新版四支柱权重合计'; weights['B9']='=SUM(B4:B7)'; weights['B9'].number_format='0.00%'
    weights['A10']='原稿四支柱合计'; weights['C10']='=SUM(C4:C7)'; weights['C10'].number_format='0.00%'
    weights['A12']='暂定评级覆盖门槛'; weights['B12']=.85; weights['B12'].number_format='0%'
    weights['A13']='单支柱最低覆盖'; weights['B13']=.70; weights['B13'].number_format='0%'
    weights['A14']='正式评级覆盖门槛'; weights['B14']=1; weights['B14'].number_format='0%'
    weights['A15']='档位'; weights['B15']='区间（左闭右开；I含5）'; weights['C15']='解释'
    for r, row in enumerate([
        ('I档 强复苏','4.2 ≤ 分数 ≤ 5.0','关注估值透支与拥挤'),
        ('II档 温和改善','3.4 ≤ 分数 < 4.2','关注修复持续性'),
        ('III档 中性平稳','2.6 ≤ 分数 < 3.4','关注结构分化'),
        ('IV档 偏弱承压','1.8 ≤ 分数 < 2.6','关注政策传导与风险'),
        ('V档 明显下行','1.0 ≤ 分数 < 1.8','关注流动性和信用风险'),
    ],16):
        for c,v in enumerate(row,1): weights.cell(r,c,v)
    style_header(weights,15,3); style_body(weights,16,20,3)
    widths(weights,{'A':25,'B':26,'C':24,'D':58,'E':22,'F':65})
    weights.freeze_panes='B4'

    catalog = wb.create_sheet('02_指标取舍')
    title(catalog,'指标取舍｜原稿完整保留', '全部原始跟踪指标保留并标记用途；核心项在03有可计算规则，其他项目用于解释与复核，不自动进入总分。',9)
    catalog.append(['序号','来源','一级','二级','指标','频率','新版角色','取舍理由／口径风险','原始表行号'])
    pillar=group=''
    source_rows=[]
    for r in range(4,71):
        vals=[original['02_跟踪指标'].cell(r,c).value for c in range(1,7)]
        if vals[0]: pillar=vals[0]
        if vals[1]: group=vals[1]
        if not vals[2]: continue
        oldname=str(vals[2]); p='宏观调控' if pillar=='政策制度' else pillar
        if oldname in SOURCE_NAMES: role='核心计分'
        elif oldname in DERIVED_SOURCE: role=DERIVED_SOURCE[oldname]
        elif p=='宏观调控': role='政策证据项（不直接计分）'
        else: role='辅助观察'
        reason = RATIONALES.get(oldname, '保留用于结构拆分、边际验证或交叉核验；暂不重复进入状态总分')
        if p=='宏观调控': reason='政策立场/市场利率并不等于经济状态改善；独立记录动作和传导。原稿名称“政策制度”统一为“宏观调控”'
        source_rows.append((p,group,oldname,vals[3],role,reason,r))
    for i,(p,g,n,f,role,reason,r) in enumerate(source_rows,1):
        catalog.append([i,'原稿',p,g,n,f,role,reason,r])
    for _,p,g,n,f,src,role,reason in ADDITIONS:
        catalog.append([catalog.max_row-2,'新增候选',p,g,n,f,role,reason+'；首选来源：'+src,'—'])
    # The derived entries have a different observation unit from the original
    # month-on-month increment and are therefore explicit new rows.
    for n, reason in [
        ('居民中长期贷款近3月同比多增（亿元）','新增派生；三个月当月值同去年对应三个月相减；来自原居民中长期贷款'),
        ('企业中长期贷款近3月同比多增（亿元）','新增派生；企事业单位口径与原表核对；来自原企业中长期贷款'),
    ]:
        catalog.append([catalog.max_row-2,'派生计算','金融信贷','信贷结构',n,'月度','核心计分',reason,'—'])
    for _,group,name,_,agency,note,_ in POLICY_CORE:
        catalog.append([catalog.max_row-2,'政策综合规则','宏观调控',group,name,'事件驱动／月度复核','核心政策评分',note+'；首选原始机构：'+agency,'—'])
    for ident,group,name,definition,frequency,unit,agency,mode,limits,weight in POLICY_METRICS:
        catalog.append([catalog.max_row-2,'政策量化子项','宏观调控',group,name,frequency,'核心量化子项',definition+'；单位：'+unit+'；首选原始机构：'+agency,'—'])
    style_header(catalog,3,9); style_body(catalog,4,catalog.max_row,9)
    catalog.auto_filter.ref=f'A3:I{catalog.max_row}'
    catalog.freeze_panes='E4'
    widths(catalog,{'A':8,'B':14,'C':16,'D':18,'E':50,'F':14,'G':28,'H':76,'I':15})

    rules = wb.create_sheet('03_核心评分规则')
    title(rules,'核心评分规则｜基本面21项 + 政策4类／6项量化子指标', '财政和货币的定量指标及阈值直接列在本表29—34行；25—26行为类别汇总、不二次计权。产业/制度看Y—AC逐档原文证据。',29)
    headers=['ID','支柱','二级','核心指标','观测口径','频率','单位','首选原始机构','支柱内权重','总权重','规则类型','阈值1','阈值2','阈值3','阈值4','2分下界','2分上界','3分下界','3分上界','4分下界','4分上界','5分下界','5分上界','口径/风险提示','1分规则','2分规则','3分规则','4分规则','5分规则']
    rules.append(headers)
    for idx, item in enumerate(CORE,4):
        limits=item['limits']
        vals=[item['id'],item['pillar'],item['group'],item['name'],item['definition'],item['frequency'],item['unit'],item['source'],item['within'],f'=I{idx}*VLOOKUP(B{idx},\'01_权重配置\'!$A$4:$B$6,2,FALSE)',item['mode']]
        vals += limits + [None]*(8 if len(limits)==4 else 4)
        # For high/low modes, thresholds go in L:O and target bounds remain P:W.
        # For target modes, L:O stay blank and P:W contain nested bands.
        if item['mode']=='目标': vals=vals[:11]+[None]*4+limits
        vals.append(item['note'])
        rules.append(vals)
    for index,(_,group,name,within,agency,note,grades) in enumerate(POLICY_CORE,25):
        total_weight='=0' if group in ('财政政策','货币政策') else f'=I{index}*VLOOKUP(B{index},\'01_权重配置\'!$A$4:$B$7,2,FALSE)'
        rules.append([f'P{index-24:02d}','宏观调控',group,name,'截至评价日有效的正式政策证据','事件驱动／月度复核','1—5分',agency,within,total_weight,'类别汇总' if group in ('财政政策','货币政策') else '原文证据']+[None]*12+[note]+list(grades))
    policy_within={'财政政策':.30,'货币政策':.30}
    for index,(ident,group,name,definition,frequency,unit,agency,mode,limits,component_weight) in enumerate(POLICY_METRICS,29):
        within=policy_within[group]*component_weight
        vals=[ident,'宏观调控',group,name,definition,frequency,unit,agency,within,f'=I{index}*\'01_权重配置\'!$B$7',mode]
        vals += limits+[None]*8
        a,b,c,d=limits
        if mode=='高优':
            grades=[f'< {a} {unit}',f'[{a}, {b}) {unit}',f'[{b}, {c}) {unit}',f'[{c}, {d}) {unit}',f'≥ {d} {unit}']
        else:
            grades=[f'≥ {d} {unit}',f'[{c}, {d}) {unit}',f'[{b}, {c}) {unit}',f'[{a}, {b}) {unit}',f'< {a} {unit}']
        vals += ['正式政策动作量化子项；阈值为研究试行，不代表政策成效；06B录入同一指标。']+grades
        rules.append(vals)
    style_header(rules,3,29); style_body(rules,4,rules.max_row,29)
    for r in range(25,29):rules.row_dimensions[r].height=105
    for r in range(4,rules.max_row+1):
        rules.cell(r,9).number_format='0.0%'; rules.cell(r,10).number_format='0.00%'
    rules.auto_filter.ref=f'A3:AC{rules.max_row}'
    rules.freeze_panes='E4'
    widths(rules,{'A':8,'B':16,'C':17,'D':48,'E':33,'F':20,'G':13,'H':28,'I':17,'J':16,'K':13,'L':11,'M':11,'N':11,'O':11,'P':12,'Q':12,'R':12,'S':12,'T':12,'U':12,'V':12,'W':12,'X':72,'Y':53,'Z':53,'AA':53,'AB':53,'AC':53})

    data = wb.create_sheet('04_本期录入')
    title(data,'本期数据录入', '仅录入评价日之前已正式发布且核验的值。F列数值和K列官方链接等由研究员填写；H/J自动计算，未核验保持空白。',12)
    data.append(['ID','支柱','指标','统计期','发布日期','观测值','核验状态','自动得分','固定总权重','得分贡献','原文链接/补充源代码','口径与修订说明'])
    for i,item in enumerate(CORE,4):
        rule_row=i
        score=f'H{i}'
        value=f'F{i}'
        if item['mode']=='高优':
            expr=f'IF({value}<\'03_核心评分规则\'!L{rule_row},1,IF({value}<\'03_核心评分规则\'!M{rule_row},2,IF({value}<\'03_核心评分规则\'!N{rule_row},3,IF({value}<\'03_核心评分规则\'!O{rule_row},4,5))))'
        elif item['mode']=='低优':
            expr=f'IF({value}<\'03_核心评分规则\'!L{rule_row},5,IF({value}<\'03_核心评分规则\'!M{rule_row},4,IF({value}<\'03_核心评分规则\'!N{rule_row},3,IF({value}<\'03_核心评分规则\'!O{rule_row},2,1))))'
        else:
            rr='03_核心评分规则'
            bands=[('V','W',5),('T','U',4),('R','S',3),('P','Q',2)]
            expr='1'
            for lo,hi,grade in reversed(bands):
                expr=f'IF(AND({value}>=\'{rr}\'!{lo}{rule_row},{value}<=\'{rr}\'!{hi}{rule_row}),{grade},{expr})'
        data.append([item['id'],item['pillar'],item['name'],None,None,None,'待核验',f'=IF(OR(NOT(ISNUMBER({value})),G{i}<>"已核验",D{i}="",E{i}="",K{i}="",\'05_评级汇总\'!$B$22="",E{i}>\'05_评级汇总\'!$B$22),"",{expr})',f'=\'03_核心评分规则\'!J{i}',f'=IF(ISNUMBER({score}),{score}*I{i},0)',None,item['definition']])
    style_header(data,3,12); style_body(data,4,data.max_row,12)
    for r in range(4,data.max_row+1):
        for col in (4,5): data.cell(r,col).number_format='yyyy-mm-dd'
        data.cell(r,9).number_format='0.00%'; data.cell(r,10).number_format='0.000'
        for col in (4,5,6,7,11,12):
            data.cell(r,col).fill=PatternFill('solid',fgColor='FFF6DD')
    status=DataValidation(type='list',formula1='"待核验,已核验,不可用"',allow_blank=False)
    status.error='请选择待核验、已核验或不可用'; status.errorTitle='核验状态'; status.showErrorMessage=True
    data.add_data_validation(status); status.add(f'G4:G{data.max_row}')
    number=DataValidation(type='decimal',operator='between',formula1='-1000000',formula2='1000000',allow_blank=True)
    data.add_data_validation(number); number.add(f'F4:F{data.max_row}')
    data.conditional_formatting.add(f'H4:H{data.max_row}',ColorScaleRule(start_type='num',start_value=1,start_color='F6DEDC',mid_type='num',mid_value=3,mid_color='FFF0CA',end_type='num',end_value=5,end_color='DDEEDB'))
    data.auto_filter.ref=f'A3:L{data.max_row}'
    data.freeze_panes='D4'
    widths(data,{'A':9,'B':16,'C':49,'D':17,'E':17,'F':17,'G':17,'H':13,'I':15,'J':15,'K':56,'L':47})

    summary=wb.create_sheet('05_评级汇总')
    title(summary,'基本面分 + 政策动作分 → 四支柱总评级', '宏观调控仅评价当期正式政策动作与改革方向；经济效果由前三支柱检验。未核验权重不填中性分；全覆盖才给正式档位。',7)
    summary.append(['一级支柱','固定权重','已核验权重','覆盖率','有效贡献','已覆盖项观察分','支柱门槛'])
    for row,pillar in zip(range(4,7),('经济运行','增长动力','金融信贷')):
        summary.append([pillar,f'=\'01_权重配置\'!B{row}',f'=SUMIFS(\'04_本期录入\'!$I$4:$I$24,\'04_本期录入\'!$B$4:$B$24,A{row},\'04_本期录入\'!$H$4:$H$24,">=1")',f'=IFERROR(C{row}/B{row},0)',f'=SUMIF(\'04_本期录入\'!$B$4:$B$24,A{row},\'04_本期录入\'!$J$4:$J$24)',f'=IF(C{row}=0,"",E{row}/C{row})',f'=IF(D{row}>=\'01_权重配置\'!$B$13,"通过","不足")'])
    summary.append(['宏观调控',"='01_权重配置'!B7",'=SUMIFS(\'06_政策评分录入\'!$L$4:$L$7,\'06_政策评分录入\'!$K$4:$K$7,">=1")','=IFERROR(C7/B7,0)',"=SUM('06_政策评分录入'!$M$4:$M$7)",'=IF(C7=0,"",E7/C7)',"=IF(D7>='01_权重配置'!$B$13,\"通过\",\"不足\")"])
    summary.append(['四支柱合计','=SUM(B4:B7)','=SUM(C4:C7)','=IFERROR(C8/B8,0)','=SUM(E4:E7)','=IF(C8=0,"",E8/C8)',"=IF(ROUND(D8,6)>='01_权重配置'!$B$14,\"正式\",IF(AND(D8>='01_权重配置'!$B$12,COUNTIF(G4:G7,\"通过\")=4),\"暂定\",\"覆盖不足\"))"])
    summary['A10']='当前基本面观察分'
    summary['B10']='=IF(SUM(C4:C6)=0,"",SUM(E4:E6)/SUM(C4:C6))'
    summary['A11']='政策观察分'
    summary['B11']='=F7'
    summary['A12']='四支柱已覆盖观察分'
    summary['B12']='=F8'
    summary['A13']='评级状态'
    summary['B13']='=G8'
    summary['A14']='正式四支柱得分'
    summary['B14']='=IF(G8="正式",E8,"")'
    summary['A15']='正式档位'
    summary['B15']='=IF(B14="","覆盖不足，不定正式档",IF(B14>=4.2,"I档 强复苏",IF(B14>=3.4,"II档 温和改善",IF(B14>=2.6,"III档 中性平稳",IF(B14>=1.8,"IV档 偏弱承压","V档 明显下行")))))'
    summary['A17']='未核验最差边界'
    summary['B17']='=E8+(1-C8)*1'
    summary['A18']='未核验最好边界'
    summary['B18']='=E8+(1-C8)*5'
    summary['A20']='口径说明'
    summary['B20']='四支柱权重固定30/30/20/20；政策结果只在前三支柱验证，避免双计。观察分按已覆盖权重归一，仅作诊断；85%为暂定门槛，100%才形成同版本可比较的正式分。'
    summary.merge_cells('B20:G20'); summary.row_dimensions[20].height=54
    summary['A22']='信息截止日（必填）'
    summary['B22']=None
    summary['B22'].number_format='yyyy-mm-dd'
    summary['B22'].fill=PatternFill('solid',fgColor='FFF6DD')
    summary['A23']='数据截断规则'
    summary['B23']='发布日期晚于信息截止日的数据不计分；历史评级保留当时可获得的原始版本。'
    summary.merge_cells('B23:G23');summary.row_dimensions[23].height=36
    style_header(summary,3,7); style_body(summary,4,8,7)
    for r in range(4,9):
        for c in (2,3,4): summary.cell(r,c).number_format='0.0%'
        for c in (5,6): summary.cell(r,c).number_format='0.00'
    for c in ('B10','B11','B12','B14','B17','B18'): summary[c].number_format='0.00'
    for r in (10,11,12,13,14,15,17,18):
        summary.cell(r,1).font=Font(name='PingFang SC',bold=True,color=BURGUNDY)
        summary.cell(r,2).font=Font(name='PingFang SC',bold=True,color=INK,size=12)
    summary.conditional_formatting.add('D4:D7',CellIsRule(operator='lessThan',formula=['0.7'],fill=PatternFill('solid',fgColor=RED)))
    widths(summary,{'A':25,'B':36,'C':19,'D':15,'E':17,'F':22,'G':20})
    summary.freeze_panes='B4'

    policy=wb.create_sheet('06_政策评分录入')
    title(policy,'宏观调控评分｜量化动作 + 原文判断', '财政和货币得分由06B量化政策动作自动带入；产业和制度逐篇研判正式原文并填O列。经济结果由前三支柱验证，不作为此处给分前提。',15)
    policy.append(['政策类别','类别内权重','政策方向','正式信号','资源/工具','动作已启动','核验状态','发布日期','官方原文链接','官方事实/研究判断/评分理由','政策得分','固定总权重','得分贡献','待验证指标','原文证据评分（1—5）'])
    for row,(category,within,validation) in enumerate([
        ('财政政策',.30,'预算执行、项目实物量、居民需求'),
        ('货币政策',.30,'融资成本、企业中长贷、信用结构'),
        ('产业政策',.20,'产能治理、订单、行业价格与盈利'),
        ('制度建设',.20,'法规生效、执行细则、市场主体反馈'),
    ],4):
        if row in (4,5):
            qrow=4 if row==4 else 5
            formula=f'=IF(ISNUMBER(\'06B_财政货币量化\'!B{qrow}),\'06B_财政货币量化\'!B{qrow},"")'
        else:
            formula=f'=IF(OR(G{row}<>"已核验",H{row}="",I{row}="",J{row}="",D{row}<>"正式",NOT(ISNUMBER(O{row})),\'05_评级汇总\'!$B$22="",H{row}>\'05_评级汇总\'!$B$22),"",O{row})'
        weight_formula=("=SUM('03_核心评分规则'!J29:J31)" if row==4 else "=SUM('03_核心评分规则'!J32:J34)" if row==5 else f"='03_核心评分规则'!J{row+21}")
        policy.append([category,within,'待判断','未确认','未明确','未执行','待核验',None,None,None,formula,weight_formula,f'=IF(ISNUMBER(K{row}),K{row}*L{row},0)',validation,None])
    for row,left,right in [(4,6,8),(5,9,11)]:
        policy.cell(row,3,f'=IF(NOT(ISNUMBER(K{row})),"待判断",IF(K{row}>3,"支持",IF(K{row}<3,"约束","中性")))')
        policy.cell(row,4,f'=IF(ISNUMBER(K{row}),"正式","未确认")')
        policy.cell(row,5,'见06B量化政策工具')
        policy.cell(row,6,'政策动作与经济效果分开')
        policy.cell(row,7,f'=IF(ISNUMBER(K{row}),"已核验","待核验")')
        policy.cell(row,8,f'=IF(ISNUMBER(K{row}),MAX(\'06B_财政货币量化\'!F{left}:F{right}),"")')
        policy.cell(row,9,f'=IF(ISNUMBER(K{row}),TEXTJOIN(CHAR(10),TRUE,\'06B_财政货币量化\'!J{left}:J{right}),"")')
        policy.cell(row,10,'财政/货币由06B自动合成；如有重要特殊工具或风险约束，在07事件台账补充说明。')
    style_header(policy,3,15); style_body(policy,4,7,15)
    for r in range(4,8):
        policy.cell(r,2).number_format='0%';policy.cell(r,8).number_format='yyyy-mm-dd';policy.cell(r,12).number_format='0.0%'
        for c in ((3,4,5,6,7,8,9,10,14) if r in (6,7) else (14,)):
            policy.cell(r,c).fill=PatternFill('solid',fgColor='FFF6DD')
    for r in (6,7):policy.cell(r,15).fill=PatternFill('solid',fgColor='FFF6DD')
    for col,choices in [('C','待判断,支持,中性,约束'),('D','未确认,正式'),('E','未明确,已明确'),('F','未执行,已执行'),('G','待核验,已核验,不可用')]:
        dv=DataValidation(type='list',formula1='"'+choices+'"',allow_blank=False)
        dv.showErrorMessage=True;policy.add_data_validation(dv);dv.add(f'{col}6:{col}7')
    policy.freeze_panes='C4'
    policy_grade=DataValidation(type='whole',operator='between',formula1='1',formula2='5',allow_blank=True)
    policy.add_data_validation(policy_grade);policy_grade.add('O6:O7')
    widths(policy,{'A':20,'B':18,'C':19,'D':16,'E':16,'F':16,'G':16,'H':18,'I':58,'J':73,'K':18,'L':17,'M':16,'N':47,'O':24})

    quant=wb.create_sheet('06B_财政货币量化')
    title(quant,'财政与货币｜逆周期动作量化', '本页录入03核心规则表29—34行的六个定量指标；阈值只在03维护，本页自动引用，避免两套规则漂移。阈值均为研究试行值。',16)
    quant.append(['政策类别','类别得分','子指标','统计口径／计算方法','统计期','发布日期','观测值','单位','核验状态','官方原文链接','1/2分界','2/3分界','3/4分界','4/5分界','子项权重','自动子项分'])
    quant.append([None]*16)
    quant.append([None]*16)
    for r,(ident,category,metric,definition,frequency,unit,agency,mode,cutoffs,weight) in enumerate(POLICY_METRICS,6):
        core_row=r+23
        val=f'G{r}'
        if mode=='高优':
            expression=f'IF({val}<K{r},1,IF({val}<L{r},2,IF({val}<M{r},3,IF({val}<N{r},4,5))))'
        else:
            expression=f'IF({val}<K{r},5,IF({val}<L{r},4,IF({val}<M{r},3,IF({val}<N{r},2,1))))'
        score=f'=IF(OR(NOT(ISNUMBER({val})),E{r}="",F{r}="",I{r}<>"已核验",J{r}="",\'05_评级汇总\'!$B$22="",F{r}>\'05_评级汇总\'!$B$22),"",{expression})'
        quant.append([category,None,metric,definition,None,None,None,unit,'待核验',None,*[f"='03_核心评分规则'!{c}{core_row}" for c in ('L','M','N','O')],weight,score])
    quant['A4']='财政政策';quant['A5']='货币政策'
    quant['B4']='=IF(COUNT(P6:P8)=3,SUMPRODUCT(O6:O8,P6:P8),"")'
    quant['B5']='=IF(COUNT(P9:P11)=3,SUMPRODUCT(O9:O11,P9:P11),"")'
    quant['C4']='按固定40%/35%/25%合成；子项缺一则类别留空'
    quant['C5']='按固定45%/35%/20%合成；子项缺一则类别留空'
    style_header(quant,3,16);style_body(quant,4,11,16)
    for r in range(6,12):
        for c in (5,6):quant.cell(r,c).number_format='yyyy-mm-dd'
        quant.cell(r,15).number_format='0%'
        for c in (5,6,7,9,10):quant.cell(r,c).fill=PatternFill('solid',fgColor='FFF6DD')
    quant_status=DataValidation(type='list',formula1='"待核验,已核验,不可用"',allow_blank=False)
    quant.add_data_validation(quant_status);quant_status.add('I6:I11')
    quant.freeze_panes='D6'
    add_note(quant,13,1,'财政融资/GDP是研究自建年度预算动作代理指标，并非官方“财政脉冲”；债务工具必须去重。专项债只统计新增发行，不把再融资债混入。')
    quant.merge_cells('A13:P13');quant.row_dimensions[13].height=40
    add_note(quant,14,1,'货币结构性工具按央行月度流动性投放表计算近三月净投放；工具更替、到期回笼及口径变化应单列说明。准备金率有差别化安排时须说明机构范围。')
    quant.merge_cells('A14:P14');quant.row_dimensions[14].height=40
    add_note(quant,15,1,'财政/货币高分表示扩张性逆周期动作更强，不表示政策一定有效或没有债务、通胀与资产价格代价；经济结果在前三支柱验证。')
    quant.merge_cells('A15:P15');quant.row_dimensions[15].height=40
    widths(quant,{'A':17,'B':15,'C':48,'D':74,'E':18,'F':18,'G':16,'H':13,'I':16,'J':68,'K':16,'L':16,'M':16,'N':16,'O':17,'P':17})

    policy_rules=wb.create_sheet('06A_政策评分细则')
    title(policy_rules,'宏观调控五档评分细则', '财政和货币采用06B的动作强度阈值；产业和制度采用正式原文证据分档。政策效果不在此处重复计分。',5)
    policy_rules.append(['得分','适用情形','必须具备的可核验证据','不能据此加分的情形','记录要求'])
    for entry in [
        (5,'财政/货币明显扩张；产业/制度形成有力的正式政策组合','量化指标达到5分区间；或正式原文具备具体工具、范围与时间表','经济结果尚未出现不扣此项分；市场传闻不得加分','记录动作、发布日、原始链接及潜在风险'),
        (4,'财政/货币温和扩张；产业/制度措施具体','量化指标达到4分区间；或正式细则、资源和适用范围明确','不要求信用、盈利已改善；仅会议表态不能给4分','写明措施、适用范围和待跟踪节点'),
        (3,'动作大体中性；或产业/制度只有正式方向尚无工具','量化指标处于3分区间；或原文方向明确但机制未定','未核实“没有变化”不能默认填0或3分','解释正负作用与证据不足处'),
        (2,'财政/货币温和收缩；产业/制度净约束偏强','量化指标落入2分区间；或正式限制措施范围明确','供给侧治理不能仅因减产就判为宏观负面','记录受益与受损部门'),
        (1,'财政/货币明显收缩；产业/制度显著削弱市场有效性','量化指标落入1分区间；或正式约束原文可核验','单一行业事件不能代替全局判断','记录范围、持续期与缓释措施'),
        ('空白','没有可靠的正式信息或方向暂不可判','核验状态为待核验，评分公式保持空白','不得把缺信息自动填为3分','到下一期继续跟踪'),
    ]:policy_rules.append(entry)
    style_header(policy_rules,3,5);style_body(policy_rules,4,9,5)
    add_note(policy_rules,11,1,'本表的政策分评价当期正式逆周期动作，不以未来效果兑现为前提。财政/货币以政策参数和预算动作量化；产业/制度依据原文中的范围、工具、时间表和改革方向判断。')
    policy_rules.merge_cells('A11:E11');policy_rules.row_dimensions[11].height=48
    add_note(policy_rules,13,1,'类别权重财政30%/货币30%/产业20%/制度20%及外层政策20%均为试行研究建议，不能临时改权重；正式使用前比较整套30/30/20/20与原版30/25/25/20的历史表现。')
    policy_rules.merge_cells('A13:E13');policy_rules.row_dimensions[13].height=45
    add_note(policy_rules,15,1,'政策强度高并不保证投资回报高；债务、通胀、资产价格和行业分配后果另列风险。经济运行、增长动力和金融信贷三个支柱验证最终效果，禁止在政策分里按结果二次加分。')
    policy_rules.merge_cells('A15:E15');policy_rules.row_dimensions[15].height=45
    add_note(policy_rules,17,1,'同一文件兼具货币和产业属性时，只把实际央行工具规模计入货币量化分；产业项评价独立的产业规则或工具，不因同一笔资金再加一次分。')
    policy_rules.merge_cells('A17:E17');policy_rules.row_dimensions[17].height=45
    widths(policy_rules,{'A':13,'B':54,'C':65,'D':58,'E':54})

    ledger=wb.create_sheet('07_政策事件台账')
    title(ledger,'政策事件台账｜证据与投研传导', '逐次追加正式事项；事实、研究判断与待验证传导分栏。季度评分只引用截至评价日正式发布且仍有效的证据。',10)
    ledger.append(['政策类别','事项/文件','发布日期','生效/执行期','官方原文链接','官方事实','政策方向（研究归纳）','资源与执行证据','传导指标/观察期','投资映射（待验证）'])
    for name in ('财政政策','货币政策','产业政策','制度建设'):
        ledger.append([name]+[None]*9)
    for _ in range(16):ledger.append([None]*10)
    style_header(ledger,3,10);style_body(ledger,4,23,10)
    for r in range(4,24):
        ledger.cell(r,3).number_format='yyyy-mm-dd'
        for c in range(2,11):ledger.cell(r,c).fill=PatternFill('solid',fgColor='FFF6DD')
    ledger.auto_filter.ref='A3:J23';ledger.freeze_panes='C4'
    widths(ledger,{'A':18,'B':42,'C':18,'D':21,'E':55,'F':68,'G':45,'H':57,'I':48,'J':60})

    history=wb.create_sheet('08_历史留档')
    title(history,'评分历史留档｜只粘贴数值', '每次评级结束后，将05汇总结果复制并“仅粘贴数值”至新行；记录当时信息集，后续数据修订不得覆写旧记录。',17)
    history.append(['评级类型','信息截止日','评价期','规则版本','经济运行分','增长动力分','金融信贷分','基本面分','宏观调控分','四支柱总分','正式档位','总覆盖率','经济覆盖','增长覆盖','金融覆盖','政策覆盖','原始数据版本/政策分歧'])
    for _ in range(20): history.append([None]*17)
    style_header(history,3,17); style_body(history,4,23,17)
    category=DataValidation(type='list',formula1='"月度观察,季度正式评级"',allow_blank=True)
    history.add_data_validation(category); category.add('A4:A500')
    for r in range(4,24):
        history.cell(r,2).number_format='yyyy-mm-dd'
        for c in (12,13,14,15,16):history.cell(r,c).number_format='0.0%'
    history.freeze_panes='E4'; history.auto_filter.ref='A3:Q23'
    widths(history,{'A':18,'B':18,'C':18,'D':17,'E':18,'F':18,'G':18,'H':17,'I':19,'J':18,'K':18,'L':16,'M':16,'N':16,'O':16,'P':16,'Q':64})

    decision=wb.create_sheet('09_关键修订')
    title(decision,'从原稿到新版：关键修订清单', '这是一份可讨论、可回测的优化建议，不代表对中国宏观当前状态的重新评级。',5)
    decision.append(['原稿问题','新版处理','保留/新增','影响','定稿前验证'])
    for x in [
        ('67项追踪、66项打分规则、无单项固定权重','保留67项原稿，21项核心评分；其余为辅助或政策观察','新增5项候选观察、2项派生核心','减少双计，提高可解释性','回测核心与辅助的增量信息'),
        ('上一版把宏观调控权重降为0，忽略政策前瞻作用','按用户选择采用30/30/20/20四支柱试行权重，并列基本面分与政策动作分','财政、货币、产业、制度四个政策子项','保留中国宏观政策的投资前瞻性','对比原版及不同权重的历史表现'),
        ('原稿把低利率、高赤字直接作为高分','财政/货币用边际政策动作量化；产业/制度按正式原文措施与改革方向分档','03核心表直接列六项量化子指标及五档阈值；06B负责录入','不必等经济结果兑现才给政策分','逐期核对发布时间、覆盖范围及修订'),
        ('宏观调控与基本面容易双计','消费、投资、信贷等政策效果仍只进前三支柱','政策事件台账记录待验证传导','区分政策预期与实际兑现','检查政策分对未来一季的增量预测力'),
        ('过热/风险定价不足却标为5分','价格与剪刀差用目标区间；市场利率不打健康分','原稿规则在备份表保留','五分方向一致','对高通胀、债市异常时期回测'),
        ('原稿部分档位重叠或空档','核心规则参数化；覆盖全数轴且只有一个得分','正式档位左闭右开','避免临界值歧义','检查每个阈值边界'),
        ('贷款当月新增季节性强','居民/企业中长贷改近3个月同比多增','原始新增额仍可看','缓和春节和信贷开门红扰动','核对当月及累计互算'),
        ('缺值时用剩余项平均','固定权重并显示覆盖；85%给暂定观察分，100%才给正式分','单柱70%为暂定最低门槛','正式总分不自动给缺失指标重新分权','模拟历史缺口并调整门槛'),
        ('M1定义调整可能造成假跳跃','M1-M2仅按相同新口径进入评分；旧口径另存','M1/M2原始增速仍看','避免跨口径假改善','核实人民银行新旧口径衔接'),
        ('名义/累计/期末口径可能混用','每项写明统计期、发布日期、单位、派生定义','信息截止日快照','防止未来数据回填','按每月发布日做点时复盘'),
    ]: decision.append(x)
    style_header(decision,3,5); style_body(decision,4,decision.max_row,5)
    decision.freeze_panes='B4'
    widths(decision,{'A':47,'B':65,'C':45,'D':37,'E':44})

    refs=wb.create_sheet('10_核验依据')
    title(refs,'口径核验与方法参考', '官方链接只支持发布/定义事实；权重、阈值及评级解释是本工作簿的研究建议，不由这些机构背书。',4)
    refs.append(['事项','机构','链接','用于本表的结论'])
    for row in [
        ('季度GDP初步核算与修订','国家统计局','https://www.stats.gov.cn/sj/zxfbhjd/202604/t20260417_1963336.html','季度GDP存在初步核算及最终核实/修订；历史快照需保留当时版本'),
        ('狭义货币M1定义','中国人民银行','https://www.pbc.gov.cn/rmyh/109339/2025080818580470423/index.html','新M1涵盖个人活期存款和非银行支付机构客户备付金；须注明口径'),
        ('就业统计与不含在校生青年失业率','国家统计局','https://www.stats.gov.cn/hd/lyzx/zxgk/202406/t20240619_1955075.html','青年就业新序列不可与旧定义直接拼接'),
        ('制造业PMI新订单指数','国家统计局','https://www.stats.gov.cn/sj/zxfbhjd/202608/t20260831_1965154.html','官方月报有新订单分项；在本版仅作景气领先观察'),
        ('服务零售额累计同比','国家统计局','https://www.stats.gov.cn/zs/tjwh/tjkw/tjqk/zgxxb/202605/P020260519307748534827.pdf','官方月报有服务零售额同比；与社会消费品零售总额口径不同'),
        ('商品房待售面积','国家统计局','https://www.stats.gov.cn/sj/zxfb/202609/t20260915_1965310.html','月末待售库存指标；与销量搭配分析'),
        ('经常账户差额与GDP之比','国家外汇管理局','https://www.safe.gov.cn/big5/big5/www.safe.gov.cn/safe/file/file/20250328/7bb9c7c80cc44982b9dfe749ceb1df6b.pdf','国际收支报告用该比率观察对外平衡'),
        ('全国预算与新增政府债务工具','财政部','https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/202503/t20250306_3959444.htm','正式预算说明包含赤字、地方专项债和特别国债安排；06B融资力度为研究自建口径，须去重并按当年预算复核'),
        ('预算执行与财政支出','财政部','https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/202509/t20250918_3972613.htm','财政收支执行数据供同月预算执行进度比较；不能把支出绝对额直接映射高分'),
        ('新增地方政府专项债券发行','财政部','https://zwgls.mof.gov.cn/tjsj/202609/t20260909_3997013.htm','财政部逐月披露新增专项债券发行额；与正式批准的年度新增限额结合计算发行进度，不混入再融资债'),
        ('7天逆回购政策利率','中国人民银行','https://www.pbc.gov.cn/goutongjiaoliu/113456/113469/5587716/2025022618190099812.pdf','央行货币政策报告讨论政策利率体系；06B采用其政策参数的六个月变化，而非市场利率点位'),
        ('中央银行工具流动性投放','中国人民银行','https://www.pbc.gov.cn/zhengcehuobisi/125207/125213/5727710/2026010517563068096/index.html','央行月度表披露其他结构性货币政策工具的投放与回笼；06B近三月净投放为研究派生指标，须注意工具更替与到期'),
        ('政策作为投资环境前瞻信息','中央经济工作会议/商务部转载通稿','https://www.mofcom.gov.cn/syxwfb/art/2025/art_de35cba3eb5d4c369b089135e92ba890.html','财政、货币、改革与产业政策有明确部署；具体评分权重仍为研究建议'),
        ('政策支持与当前内需区分','国际货币基金组织','https://www.imf.org/en/news/articles/2026/02/18/pr-26053-china-imf-executive-board-concludes-2025-article-iv-consultation','政策刺激可支持增长，但现实需求可能仍弱；两类信息宜并列展示'),
        ('原稿来源','用户提供的中国宏观分析框架.xlsx','本工作簿的原稿四表','原始指标与旧规则完整存档；报告目录按用户要求未纳入'),
    ]: refs.append(row)
    style_header(refs,3,4); style_body(refs,4,refs.max_row,4)
    for r in range(4,refs.max_row):
        if str(refs.cell(r,3).value).startswith('http'):
            refs.cell(r,3).hyperlink=refs.cell(r,3).value
            refs.cell(r,3).style='Hyperlink'
    widths(refs,{'A':36,'B':24,'C':88,'D':91})

    example=wb.create_sheet('11_填表示例')
    title(example,'填表示例｜全部为假设数', '仅演示阈值怎样映射为1—5分，不代表任何时期的真实数据，也不参与04本期录入或05评级汇总。',5)
    example.append(['指标','假设值','试行规则','对应得分','说明'])
    for row in [
        ('GDP同比增速（%）',5.2,'<3=1；3—4=2；4—5=3；5—6=4；≥6=5',4,'假设值落在5—6；年度目标调整后须重审阈值'),
        ('CPI同比（%）',2.0,'1.5—2.5=5；区间外逐级扣分',5,'展示目标区间，而非越高越好'),
        ('城镇调查失业率（%）',5.2,'<4.5=5；4.5—5=4；5—5.5=3；5.5—6=2；≥6=1',3,'展示低优规则'),
        ('财政融资力度同比变化（百分点）',1.2,'<-1=1；-1—-0.25=2；-0.25—0.25=3；0.25—1=4；≥1=5',5,'纯假设的量化子项；财政类别还需预算执行进度子项'),
    ]: example.append(row)
    style_header(example,3,5); style_body(example,4,6,5)
    widths(example,{'A':35,'B':17,'C':68,'D':17,'E':56})

    for source_sheet in list(original)[:4]:
        archive=wb.create_sheet('原稿_'+source_sheet.title[3:])
        for source_row in source_sheet.iter_rows():
            for cell in source_row:
                if cell.value is not None:
                    target=archive.cell(cell.row,cell.column,cell.value)
                    if cell.has_style:
                        target.font=copy(cell.font)
                        target.fill=copy(cell.fill)
                        target.border=copy(cell.border)
                        target.alignment=copy(cell.alignment)
                        target.number_format=cell.number_format
        archive.sheet_view.showGridLines=False
        archive.freeze_panes='C4' if source_sheet.title=='02_跟踪指标' else 'C2'
        archive.sheet_properties.tabColor='AEB1B3'
        for c in range(1,source_sheet.max_column+1):
            archive.column_dimensions[get_column_letter(c)].width=45 if c>=3 else 22
        for r in range(1,source_sheet.max_row+1):
            archive.row_dimensions[r].height=31

    wb.active=0
    wb.calculation.fullCalcOnLoad=True
    wb.calculation.forceFullCalc=True
    wb.calculation.calcMode='auto'
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    wb.save(OUTPUT)
    return OUTPUT


if __name__=='__main__':
    print(build())
