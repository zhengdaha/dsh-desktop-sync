# 外贸单证一致性核验 V2 (Export Document Consistency Checker)

## 核验目标

对外贸出口流程中的核心单据进行跨文件一致性核验，识别数据不一致、缺失和歧义项，确保单证之间关键字段的准确性。

**V2 核心改进：** 根因去重、字段适用性矩阵、风险分级规则化、可配置容差、禁止污染业务工作区。

---

## 支持的文档类型

按优先级排序：

| 文档类型 | 英文名称 | 识别特征 |
| -------- | -------- | -------- |
| 采购订单 | Purchase Order / PO | PO No., Buyer, Order Date, 包含商品明细与单价 |
| 商业发票 | Commercial Invoice / CI | Invoice No., 包含单价与总金额、付款条款 |
| 装箱单 | Packing List / PL | Packing List 标题, 含箱号、包装方式、毛/净重 |
| 提单草稿 | B/L Draft | B/L No., 船名/航次, 装货港/卸货港, 集装箱号 |

---

## 文档-字段适用性矩阵 (Document-Specific Field Applicability Matrix)

**不得因为"某份单据没有另一个单据中的字段"就自动判 Needs Review。**
**先判断该字段对于当前单据类型的适用性级别。**

| Field                           | PO                        | Commercial Invoice | Packing List   | B/L Draft      |
| ------------------------------- | ------------------------- | ------------------ | -------------- | -------------- |
| Quantity                        | Required                  | Required           | Required       | Expected       |
| Unit Price                      | Required                  | Required           | Not Applicable | Not Applicable |
| Amount                          | Required                  | Required           | Not Applicable | Not Applicable |
| Currency                        | Required                  | Required           | Not Applicable | Not Applicable |
| Packages                        | Optional                  | Optional           | Required       | Required       |
| Gross Weight                    | Optional                  | Optional           | Required       | Required       |
| Net Weight                      | Optional                  | Optional           | Required       | Optional       |
| Consignee                       | Expected                  | Expected           | Expected       | Required       |
| Port of Loading                 | Expected                  | Expected           | Expected       | Required       |
| Destination / Port of Discharge | Expected                  | Expected           | Expected       | Required       |
| Related PO No.                  | Self-reference / Optional | Expected           | Expected       | Optional       |
| Shipping Marks                  | Optional                  | Optional           | Expected       | Expected       |

### 适用性级别定义

| 级别 | 含义 | 缺失时的处理 |
| ---- | ---- | ------------ |
| **Required** | 该单据类型必须包含此字段 | 缺失 → **Needs Review** |
| **Expected** | 该单据类型通常包含此字段 | 缺失 → 根据上下文决定是否 Needs Review |
| **Optional** | 该单据类型可能包含此字段 | 缺失 → **默认不报异常** |
| **Not Applicable** | 该单据类型不适用此字段 | **不参与缺失判断** |

### 特别规则

- **B/L Draft 没有 Net Weight 时**：不得仅因为 Packing List 有 Net Weight 就自动报 Needs Review。B/L 的 Net Weight 在当前规则中为 Optional。
- **B/L Draft 没有 Amount/Currency 时**：Not Applicable，不参与缺失判断。
- **Packing List 没有 Amount/Currency 时**：Not Applicable，不参与缺失判断。

---

## 核验字段

### 必须核验的字段列表

| 字段 | 英文名 | 说明 |
| ---- | ------ | ---- |
| 数量 | Qty / Quantity | 各商品的数量 |
| 包装件数 | Packages / Total Packages | 总包装件数 |
| 毛重 | Gross Weight | 总毛重 |
| 净重 | Net Weight | 总净重 |
| 金额 | Amount / Total Amount | 发票总金额 |
| 币种 | Currency | 结算币种（USD, EUR, CNY 等） |
| 目的港 | Destination / Port of Destination | 卸货港/最终目的地 |
| 收货人 | Consignee | 收货人名称与地址 |

### 辅助核验字段

- 发票号 (Invoice No.)
- 合同号 / PO No.
- 装货港 (Port of Loading)
- 船名/航次 (Vessel/Voyage)
- 唛头 (Shipping Marks)
- 商品描述 (Description of Goods)
- 贸易术语 (Incoterms)
- 付款条款 (Payment Terms)
- 集装箱号 (Container No.)

---

## 工作流程

### 第一步：扫描工作区

1. 使用 `glob` 工具扫描当前工作区的所有文件
2. 优先识别 `.pdf`, `.xlsx`, `.xls`, `.docx`, `.csv`, `.txt`, `.png`, `.jpg` 文件
3. 对于非文本文件（PDF, Excel, 图片），使用 `read` 或 `pwsh` 提取文本内容
4. 记录每个文件的路径和大致内容

**⚠️ 禁止污染工作区：**
- **不得**在 Workspace 中创建 `decode_pdf.js`、`parse_pdf.py`、`temp.txt`、`extract.json` 或任何其他 PDF 解析临时脚本/中间文件
- 如果确实需要临时解析能力，优先使用已有工具或系统临时目录
- 如果环境无法做到，应当告诉用户存在解析限制，而不是污染业务目录

### 第二步：判断文档类型

根据文件内容判断每个文件属于哪种文档类型：
- 搜索关键词匹配：PO → "Purchase Order", "P/O", "PO No."
- CI → "Commercial Invoice", "Invoice No.", "INV"
- PL → "Packing List", "Packing", "Package"
- B/L → "Bill of Lading", "B/L", "Ocean B/L", "Shipper", "Vessel"

如果一个文件无法确定类型，标记为 "Unknown" 并在输出中注明。

### 第三步：抽取字段

从每个已识别的文档中抽取核验字段：

1. **数量 (Qty)**：从 PO 的商品明细行、CI 的商品明细行、PL 的装箱明细中提取
2. **包装件数 (Packages)**：从 PL 的总箱数、CI 的 Total Packages 中提取
3. **毛重 (Gross Weight)**：从 PL 的 Gross Weight 总计、B/L 的 Gross Weight 中提取
4. **净重 (Net Weight)**：从 PL 的 Net Weight 总计中提取
5. **金额 (Amount)**：从 CI 的 Total Amount 中提取
6. **币种 (Currency)**：从 CI 的金额字段旁提取
7. **目的港 (Destination)**：从 B/L 的 Port of Discharge 或 Place of Delivery 中提取
8. **收货人 (Consignee)**：从 B/L 或 CI 的 Consignee 字段中提取

### 第四步：标准化

对抽取的字段进行标准化处理：

1. **数字格式**：去除千分位分隔符（逗号），统一小数点格式，处理科学计数法
2. **单位转换**：
   - 重量统一为 KG。如遇到 LBS，乘以 0.453592 转换为 KG
   - 体积统一为 CBM。如遇到 CFT，乘以 0.0283168 转换为 CBM
   - KGS ↔ KG 视为同一单位
3. **币种标准化**：统一为大写三位代码（USD, EUR, CNY, GBP, JPY 等）
4. **名称标准化**：去除多余空格、统一大小写、处理常见缩写
   - "Limited" ↔ "Ltd."
   - "Corporation" ↔ "Corp."
   - "Incorporated" ↔ "Inc."
   - "GmbH" ↔ "GMBH"（大小写差异不算冲突）
5. **日期格式**：统一为 YYYY-MM-DD 格式
6. **港口名称**：使用标准港口名称，注意同一港口的不同拼写

### 第五步：建立跨文件一致性矩阵

创建一个矩阵，以字段为行，以文档为列：

```
字段              | PO          | CI          | PL          | B/L         | 一致?
------------------|-------------|-------------|-------------|-------------|-------
Qty (Total)       | 1000 pcs    | 1000 pcs    | 1000 pcs    | -           | ✓
Packages          | -           | 50 CTNS     | 50 CTNS     | 50 CTNS     | ✓
Gross Weight      | -           | 1250.00 KG  | 1250.00 KG  | 1250.00 KGS | ✓
Net Weight        | -           | 1000.00 KG  | 1000.00 KG  | -           | ✓
Amount            | $25,000.00  | $25,000.00  | -           | -           | ✓
Currency          | USD         | USD         | -           | -           | ✓
Destination       | -           | HAMBURG     | -           | HAMBURG     | ✓
Consignee         | -           | ABC GmbH    | -           | ABC GMBH    | ⚠
```

- `✓` 表示所有有值的文档中该字段一致
- `⚠` 表示存在不一致，需要进一步审查
- `✗` 表示存在明确冲突
- `-` 表示该文档中无此字段（先检查适用性矩阵：Not Applicable 或 Optional 的缺失是正常的）
- `?` 表示值存在但无法确定是否一致（如名称缩写不同）

### 第六步：计算校验

对可验证的字段进行重新计算：

1. **金额校验**：Quantity × Unit Price = Amount（允许 ±0.5% 的四舍五入误差）
   - 差异 > 0.5% → Critical
2. **Gross Weight 跨文件校验**（V2 阈值规则）：
   - Difference = 0 → Consistent
   - Difference > 0 且 Difference Rate ≤ 0.1% → Needs Review
   - Difference Rate > 0.1% → Critical
   - 计算方式：`Difference Rate = |A - B| / max(A, B) × 100%`
   - **必须在报告中注明：0.1% 为当前 PoC 的可配置业务阈值，不代表法规统一要求。不得声称这是 SOLAS、海关或其他法规规定的固定阈值。**
3. **净重校验**：∑(单品净重 × 数量) = 总净重（允许 ±1% 误差）
   - 差异 > 1% → Needs Review
4. **包装件数校验**：∑(各箱件数) = 总包装件数
   - 差异 > 0 → Critical
5. **数量校验**：PO 各商品数量 = CI 各商品数量 = PL 各商品数量

### 第七步：问题分类与根因去重

#### 根因去重 (Root Cause Deduplication)

**同一个业务根因引起多个字段异常时，不得重复计算多个 Critical Issue。**

在输出 Critical Issues 之前，执行以下去重步骤：
1. 列出所有检测到的异常字段
2. 判断哪些异常共享同一个根因
3. 每个独立根因只计为一个 Root Critical
4. 由该根因引起的其他字段异常列为 Related Impact

**示例：**

Destination / Port of Discharge 冲突（Hamburg vs Rotterdam）引起 Shipping Marks 中的目的地差异：
- **Root Critical #1**：Destination / Port of Discharge Conflict
- **Related Impact**：Shipping Marks destination also differs → 不单独计为 Critical

**只有在 Shipping Marks 存在与 Destination 无关的独立错误时才单独报 Critical：**
- PO Number 不一致
- Consignee 不一致
- Country of Origin 不一致
- Marks Number 不一致

#### 风险分级规则

风险分类必须由以下明确规则驱动，不得自由决定。

##### Critical

满足以下条件之一：

1. 明确存在业务值冲突，并可能改变运输、清关、付款、交付或正式单据签发结果
2. Destination / Port of Discharge 明确冲突
3. Consignee 明确为不同主体（非缩写/拼写差异）
4. Currency 明确冲突
5. Quantity 明确冲突且不是格式问题
6. Amount 重新计算后与单据记载金额明显不一致（差异 > 0.5%）
7. Gross Weight 跨文件差异超过当前 PoC 配置的允许差异阈值（默认 0.1%）
8. 包装件数不一致

##### Needs Review

用于：

- 信息不足以确认正确值
- 字段缺失但该字段属于 Required / Expected
- 无法确认两个名称是否为同一主体
- 数值存在小范围差异（Gross Weight 差异 ≤ 0.1%）
- 需要合同、信用证、订舱委托或其他外部资料才能判断
- 当前单据内容不足以确认正确值
- FOB + Freight Prepaid 组合（见专项规则）
- 模糊的 OCR 识别结果
- 日期格式不一致但可合理推断

##### Consistent

标准化以后业务含义和值一致，计算校验结果在容差范围内。

---

## 专项规则

### 规则一：Related PO No. 判断（优化版）

**不要只检查是否存在名为 `Related PO No.` 的固定字段。**
应该判断"是否能够从整份单据中可靠建立该文件与 PO 的业务关联"。

可接受的关联证据包括：
- Related PO No. 字段
- PO No. 字段
- Shipping Marks 中出现 PO No.
- Cargo Description 中出现 PO No.
- Reference 区域出现 PO No.

**判断逻辑：**
- 如果 B/L Draft 没有单独的 Related PO No. 字段，但 Shipping Marks 中明确出现 `PO-2026-0815-017`，则标记为 `PO linkage confirmed`，默认不报 Needs Review
- 只有在整份 B/L 中都无法找到可确认的 PO / Invoice / Shipment 关联信息时，才标记 Needs Review

### 规则二：FOB / Freight Prepaid 判断（降级为 Contractual Check）

**禁止使用以下简单逻辑：**
`FOB = Freight Collect` → `FOB + Freight Prepaid = 错误`

FOB Incoterm 与 B/L Freight Terms 属于不同维度的信息。

**当发现 PO / CI 为 FOB，B/L 为 FREIGHT PREPAID 时：**

只能输出：**Needs Review — Contractual Check**

推荐解释：
> "FOB 与 Freight Prepaid 并非天然互斥。仅根据当前单据无法确定该组合是否错误，需要结合销售合同、订舱委托、运费结算安排或信用证条款确认。"

**禁止：**
- 建议把 FOB 改成 CIF
- 建议把 FOB 改成 C&F
- 建议把 Freight Prepaid 改成 Freight Collect

除非用户另外提供合同或明确规则作为依据。

**建议输出格式：**

```
### Needs Review — Freight Terms / Incoterm Contractual Check

Evidence:
- PO: FOB Ningbo
- Commercial Invoice: FOB Ningbo
- B/L: Freight Prepaid

Assessment:
Current documents alone are insufficient to determine an error.

Recommended Action:
Check contract / booking instruction / freight settlement terms.
```

### 规则三：Shipping Marks 关联影响机制

Shipping Marks 必须检查。

**但如果 Shipping Marks 的差异明显是由 Destination / Port of Discharge 冲突引起，则 Shipping Marks 差异应列为 Related Impact，不单独计为 Root Critical。**

**报告结构：**

```
### Critical #1 — Destination / Port of Discharge Conflict

Root Cause:
B/L Draft destination differs from PO / Commercial Invoice / Packing List.

Evidence:
- PO / CI / PL: HAMBURG
- B/L Draft: ROTTERDAM

Related Impact:
- B/L Shipping Marks also show ROTTERDAM
- Shipping Marks must be reviewed together with the confirmed destination
```

只有在 Shipping Marks 存在与 Destination 无关的独立错误时才单独报 Critical：
- PO Number 不一致
- Consignee 不一致
- Country of Origin 不一致
- Marks Number 不一致

### 规则四：Gross Weight 可配置容差

使用以下 PoC 默认阈值（可配置业务阈值，非法规要求）：

| 差异 | 差异率 | 分类 |
| ---- | ------ | ---- |
| 0 | 0% | Consistent |
| > 0 | ≤ 0.1% | Needs Review |
| > 0 | > 0.1% | Critical |

**计算方式：**
`Difference Rate = |A - B| / max(A, B) × 100%`

**示例：**
- Packing List = 10,200 KGS
- B/L Draft = 10,180 KGS
- Difference = 20 KGS
- Difference Rate ≈ 0.196%
- 按 0.1% 阈值 → **Critical**

**必须在报告中注明：**
> "0.1% 为当前 PoC 的可配置业务阈值，不代表法规统一要求。不得声称这是 SOLAS、海关或其他法规规定的固定阈值。"

### 规则五：核验日期来源

报告中的 **核验日期 / Audit Date** 只能来源于：
1. 系统当前日期
2. Session 当前日期
3. 明确可用的运行环境日期

**禁止：**
- 使用 PO Date 作为 Audit Date
- 使用 Invoice Date 作为 Audit Date
- 使用 Packing List Date 作为 Audit Date
- 使用 B/L Date 作为 Audit Date
- 使用任意业务单据日期作为 Audit Date

如果无法可靠获取当前系统日期：
输出 `Audit Date: unavailable`，不得猜测。

---

## 输出格式

### 必须包含的输出部分

#### 1. 单据识别结果

```
## 单据识别结果

| 文件 | 判断类型 | 识别依据 | 适用性级别 |
|------|---------|---------|-----------|
| PO_2024_001.pdf | Purchase Order | PO No. PO-2024-001 | — |
| INV_2024_001.pdf | Commercial Invoice | Invoice No. INV-2024-001 | — |
| PL_2024_001.pdf | Packing List | "Packing List" header | — |
| BL_Draft.pdf | B/L Draft | "Bill of Lading", Vessel name | — |
```

#### 2. 字段一致性矩阵

按适用性矩阵标注每个文档中该字段的适用性级别。

```
## 字段一致性矩阵

字段              | PO (Req/Opt) | CI (Req/Opt) | PL (Req/Opt) | B/L (Req/Opt) | 状态
------------------|-------------|-------------|-------------|-------------|------
Qty (Total)       | 100 SETS    | 100 SETS    | 100 SETS    | - (Exp)     | ✓
Packages          | - (Opt)     | 50 CASES    | 50 CASES    | 50 CASES    | ✓
Gross Weight      | - (Opt)     | - (Opt)     | 10,200 KGS  | 10,180 KGS  | ✗
Net Weight        | - (Opt)     | - (Opt)     | 9,800 KGS   | - (Opt)     | ✓
Amount            | $125,000.00 | $125,000.00 | - (N/A)     | - (N/A)     | ✓
Currency          | USD         | USD         | - (N/A)     | - (N/A)     | ✓
Destination       | HAMBURG     | HAMBURG     | HAMBURG     | ROTTERDAM   | ✗
Consignee         | - (Exp)     | HANSEATIC.. | - (Exp)     | HANSEATIC.. | ✓
```

图例：Req = Required, Exp = Expected, Opt = Optional, N/A = Not Applicable

#### 3. 计算校验结果

```
## 计算校验结果

| 校验项 | 计算方式 | 期望值 | 实际值 | 差异 | 差异率 | 状态 |
|--------|---------|--------|--------|------|--------|------|
| 金额校验 | 100 × $1,250 | $125,000 | $125,000 | $0 | 0.00% | ✓ |
| 毛重校验 | PL vs B/L | 10,200 KGS | 10,180 KGS | 20 KGS | 0.196% | ✗ Critical |
```

#### 4. Root Critical Issues（独立根因，去重后）

每个 Critical Issue 必须包含：Root Cause、Evidence、Related Impacts（如有）。

```
## Root Critical Issues

### Critical #1 — Destination / Port of Discharge Conflict

Root Cause:
B/L Draft destination (ROTTERDAM) differs from PO / CI / PL (HAMBURG).

Evidence:
- PO: Hamburg, Germany
- Commercial Invoice: Hamburg, Germany
- Packing List: Hamburg, Germany
- B/L Draft: Rotterdam, Netherlands

Related Impact:
- B/L Shipping Marks also show ROTTERDAM
- Shipping Marks destination must be synchronized after destination is confirmed
```

```
### Critical #2 — Gross Weight Discrepancy

Root Cause:
Packing List (10,200 KGS) vs B/L Draft (10,180 KGS) exceeds 0.1% PoC threshold.

Evidence:
- Packing List: 10,200 KGS
- B/L Draft: 10,180 KGS
- Difference: 20 KGS (0.196%)

Note: 0.1% is the current PoC configurable business threshold, not a regulatory requirement.
```

#### 5. Needs Review 问题

```
## Needs Review

### Needs Review #1 — Freight Terms / Incoterm Contractual Check

Evidence:
- PO: FOB Ningbo
- Commercial Invoice: FOB Ningbo
- B/L: Freight Prepaid

Assessment:
Current documents alone are insufficient to determine an error.
FOB and Freight Prepaid are not inherently mutually exclusive.

Recommended Action:
Check contract / booking instruction / freight settlement terms.

---

### Needs Review #2 — B/L Draft Missing PO Linkage

Evidence:
- B/L Draft does not contain an explicit Related PO No. field
- Shipping Marks and Cargo Description were checked

Assessment:
Unable to confirm PO linkage from the B/L Draft content.

Recommended Action:
Verify whether the B/L Draft corresponds to the identified PO.
```

#### 6. Documents To Review（待复核单证清单）

**不得直接假定哪份单据错了。** 当存在差异且无法从现有单据确定正确值时，应列为 "Documents To Review" 而非 "Documents To Amend"。

```
## Documents To Review

| 文件 | 需复核内容 | 优先级 | 依据 |
|------|-----------|--------|------|
| B/L Draft | 确认 Port of Discharge | 高 | PO/CI/PL 均为 HAMBURG，优先确认运输指示 |
| B/L Draft | 确认 Gross Weight | 高 | 需根据实际称重记录确认正确值 |
| Packing List | 确认 Gross Weight | 高 | 需根据实际称重记录确认正确值 |
```

**规则：**
- 当 PO / CI / PL 三份一致而 B/L 不同时，可以说明多数证据指向某一方，但应写"优先确认运输指示 / booking instruction / carrier confirmation。确认实际路线后修改错误单据。"
- 当 Gross Weight 存在差异时，应写"需要根据实际称重记录 / weighbridge slip / VGM source 确认正确值，再修改错误的一方。"
- 不要把模型推断当成事实。

#### 7. Audit Summary（审查摘要）

**Critical Issues 必须统计"独立根因数量"，不能统计关联影响数量。**

```
## Audit Summary

- Audit Date: 2026-08-21 (system date)
- Files Checked: 4
- Fields Checked: 12
- Root Critical Issues: 2
- Related Impacts: 1
- Needs Review: 2
- Consistent Fields: 8

### Highest Priority Actions

1. Confirm Port of Discharge: Hamburg vs Rotterdam
   Related Impact: Shipping Marks destination must be synchronized after destination is confirmed.

2. Confirm Gross Weight: 10,200 KGS vs 10,180 KGS
   Action: Verify against weighbridge slip / VGM source.
```

---

## 全局规则

1. **不允许猜测缺失字段**：如果某个字段无法从任何文档中确定，必须标记为 Needs Review，不得猜测或填入默认值
2. **不修改原始业务文件**：所有分析仅读取文件，不执行任何写入、编辑或转换操作
3. **禁止污染业务工作区**：
   - 不修改原始 PDF
   - 不创建新的业务文件
   - 不删除文件
   - 不重命名文件
   - **不得在 Workspace 中创建** `decode_pdf.js`、`parse_pdf.py`、`temp.txt`、`extract.json` 或任何其他 PDF 解析临时脚本/中间文件
   - 如果确实需要临时解析能力，优先使用已有工具或系统临时目录
   - 如果环境无法做到，应当告诉用户存在解析限制，而不是污染业务目录
4. **保留原始值**：在矩阵中同时展示原始值和标准化后的值，以便追溯
5. **处理 OCR 文本**：如从 PDF 或图片中提取文本，需注意 OCR 错误（如 0↔O, 1↔l, 5↔S），在不确定时标记 Needs Review
6. **Excel 文件处理**：如为 .xlsx 文件，使用 `pwsh` 调用 `Import-Excel` 或读取 CSV 格式数据
7. **多币种处理**：如果 PO 用一种币种、CI 用另一种，标记为 Critical 并注明汇率换算需求
8. **根因去重**：同一个业务根因引起多个字段异常时，只计一个 Root Critical，其余列为 Related Impact
9. **字段适用性**：先判断字段对当前单据类型的适用性级别（Required / Expected / Optional / Not Applicable），再决定是否报异常
10. **阈值透明**：Gross Weight 0.1% 阈值是 PoC 可配置业务参数，非法规要求
11. **不直接假定哪份单据错误**：Documents To Review 而非 Documents To Amend，除非有确凿证据
12. **核验日期**：只能使用系统/Session 日期，不得使用业务单据日期

---

## V2 Demo 回归测试预期

以下为当前 Demo 的预期行为，升级后必须验证：

### Consistent

- Quantity：100 SETS
- Packages：50 WOODEN CASES
- Unit Price：USD 1,250.00
- Amount：USD 125,000.00
- Currency：USD
- Consignee：HANSEATIC MACHINERY IMPORT GMBH
- Port of Loading：NINGBO, CHINA
- Amount Calculation：100 × 1,250 = 125,000 ✓

### Root Critical #1 — Destination Conflict

- PO / CI / PL：Hamburg, Germany
- B/L Draft：Rotterdam, Netherlands
- Shipping Marks 的 Hamburg / Rotterdam 差异 → **Related Impact**
- **不得单独增加一个 Root Critical**

### Root Critical #2 — Gross Weight Discrepancy

- Packing List：10,200 KGS
- B/L：10,180 KGS
- Difference：20 KGS
- Difference Rate：≈ 0.196%
- 在当前 PoC 0.1% 阈值下 → **Critical**

### 不应再出现的误报

- ❌ 不要因为 B/L 没有 Net Weight 就自动报警（B/L Net Weight = Optional）
- ❌ 不要因为 B/L 没有单独名为 Related PO No. 的字段就自动报警（检查 Shipping Marks / Cargo Description 中的 PO 信息）

### Needs Review

- FOB + Freight Prepaid → **只能作为 Needs Review — Contractual Check**，不能判定为明确错误