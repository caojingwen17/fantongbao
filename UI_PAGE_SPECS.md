# 饭桶宝（Fantongbao）页面规格说明（可投喂 AI 生成 UI 设计稿）

本文件从**真实代码仓库**（`miniprogram/app.json` 路由 + 各页面 `.wxml/.js/.json` + `cloudfunctions/*`）梳理出：

- 全量页面清单（路由）
- 每个页面的：内容区块、交互、状态（加载/空/禁用/确认弹窗）、跳转路径、关键数据动作（云函数语义）
- 一段可直接复制给 UI 生成类 AI 的“设计稿生成指令”

> 备注：仓库中还存在 `ui/` 目录的静态 HTML 设计原型（Apricot Breeze / Kitchen Hearth），本文件以**小程序真实页面实现**为主。

---

## 可直接投喂 AI 的“设计稿生成指令”（整段复制即可）

你是资深移动端产品设计师，请为一个微信小程序「饭桶宝」生成 UI 设计稿（支持家庭多人协作：菜谱→点菜→买菜→做菜闭环）。

**设备与尺寸**
- iPhone 13 竖屏（390×844）

**风格**
- 浅色主题为主
- 温暖家常、卡片化布局、圆角、轻阴影
- 列表可滑动，主按钮醒目，危险操作红色强调
- 可操作元素尺寸符合移动端可点击区域（>= 44px）

**输出要求（每个页面都要）**
- 顶部/内容/底部布局
- 组件清单（卡片、列表、按钮、输入框、tabs、modal、toast、loading）
- 空态 / 加载态 / 禁用态 / 错误提示态
- 关键交互：点击/输入/长按/勾选后发生什么（含确认弹窗文案）
- 页面跳转路径（route）
- 关键状态：点菜单状态（待买菜/待制作/已完成）对 UI 的影响

**注意**
- 同一页面若存在多状态（例如点菜单状态、加载/空态），请分别出图或在同一张图中标注状态切换。
- 所有中文文案尽量与下方规格一致。

下面是页面规格（逐页）。请严格按规格生成设计稿：

---

## 全量页面清单（以 `miniprogram/app.json` 为准）

1. `/pages/index/index`：首页（当前家庭、待处理点菜单、常用菜谱、入口）
2. `/pages/login/login/index`：登录（选头像、填昵称、登录态恢复）
3. `/pages/family/family/index`：家庭管理（家庭列表、创建/加入、家庭详情/成员/邀请码/退出）
4. `/pages/recipe/list/index`：菜谱列表（搜索、进入详情、长按编辑/删除）
5. `/pages/recipe/add/index`：添加菜谱（先填菜名→链接解析/多图 AI 导入→编辑并保存）
6. `/pages/recipe/edit/index`：编辑菜谱（改字段、换图、保存）
7. `/pages/recipe/detail/index`：菜谱详情（展示图、食材/调料/步骤、点菜入口）
8. `/pages/recipe/note/index`：点菜备注（可选备注→加入当前待买菜点菜单）
9. `/pages/order/list/index`：点菜单列表（按状态切换：待买菜/待制作/已完成）
10. `/pages/order/choose/index`：点菜页（浏览菜谱→加入点菜单；顶部显示当前待买菜菜单+删菜）
11. `/pages/order/detail/index`：点菜单详情（已点菜品+备注；删菜；去买菜/去做菜/继续加菜）
12. `/pages/shopping/shopping/index`：买菜清单（食材归并勾选、来源标注、手动加购、删手动项、继续加菜、完成买菜）
13. `/pages/cooking/cooking/index`：做菜清单（按菜分组，备菜/做菜步骤勾选，折叠展开，做完闭环）

> 代码中还有 `miniprogram/pages/example/index`，但不在 `app.json` 中，视为示例/未启用页面。

---

## 关键业务状态（影响 UI 的核心）

### 点菜单 `status`
- **`pending_shopping`（待买菜）**
  - 允许：加菜、删菜、手动加购、勾选采购项、完成买菜
- **`pending_cooking`（待制作）**
  - 允许：进入做菜清单勾选步骤
  - UI 仍会显示“继续加菜”入口（实现中跳到点菜页；后续点菜会创建/加入新的待买菜单）
  - 禁止：删菜、删除手动采购项、完成买菜
- **`completed`（已完成）**
  - 只读查看

### 买菜清单“归并显示”规则（云端实现要点）
- 同名 + 同单位的食材/调料合并，显示合计用量
- 无法解析用量时，要求 amount 文本一致才合并
- 展示来源：`来自：菜谱1、菜谱2`
- 手动添加项来源显示为“手动添加”

---

## 页面规格（逐页）

### 1) 首页 `/pages/index/index`

**页面目标**：进入产品主工作台；展示当前家庭上下文、待处理点菜单快捷入口、常用菜谱与“查看全部/添加菜谱”入口。

**内容区块**
- **家庭卡片（顶部）**
  - 当前家庭名（无则显示“未选择家庭”）
  - 成员数：`成员 X 人`
  - 刷新提示：`更新中…`（刷新时显示）
  - 点击家庭名区域：打开“家庭切换浮层”
- **家庭切换浮层（遮罩 + 面板）**
  - 顶部显示当前家庭邀请码（有则显示）
  - 家庭列表：家庭名 + `当前` 标识
  - 按钮：`家庭管理`
- **待处理点菜单**
  - 标题：`待处理点菜单`
  - 列表项：`待买菜/待制作` + 点菜单名
  - 空态：`暂无待处理点菜单`
- **常用菜谱**
  - 标题：`常用菜谱`
  - 网格卡片：菜谱图 + 菜名（最多 6）
  - 空态：`暂无菜谱`
  - 操作按钮：`查看全部`、主按钮 `添加菜谱`

**交互**
- 进入页面：
  - 未登录：跳登录页（reLaunch）
  - 已登录但无当前家庭：跳家庭管理页（redirectTo）
  - 有家庭：拉取首页数据
- 切换家庭：打开浮层 → 点击家庭 → 切换 currentFamilyId → 关闭浮层 → 刷新首页
- 点击待处理点菜单项：进入 `/pages/order/detail/index?orderId=...`
- 点击菜谱卡片：进入 `/pages/recipe/detail/index?recipeId=...`
- 按钮跳转：
  - `家庭管理` → `/pages/family/family/index`
  - `查看全部` → `/pages/recipe/list/index`
  - `添加菜谱` → `/pages/recipe/add/index`

**状态**
- 刷新态：导航条 loading + `更新中…`
- 空态：无待处理点菜单 / 无菜谱

**数据动作（云函数语义）**
- 家庭成员：`familyFunctions.getFamilyMembers(familyId)`
- 待处理点菜单（各取 1）：`orderFunctions.listFirstOrdersByStatuses(familyId)`
- 菜谱列表：`recipeFunctions.listRecipes(familyId, keyword="")`（取前 6）

---

### 2) 登录 `/pages/login/login/index`

**页面目标**：选择头像 + 填昵称完成登录；支持静默恢复登录。

**内容区块**
- 标题：`饭桶宝`
- 说明：`请设置头像、填写昵称后登录，用于家庭内展示`
- 静默恢复提示：`正在恢复登录…`
- 表单：
  - 头像选择按钮（chooseAvatar）
    - 未选：`点击选择头像`
    - 已选：头像预览
  - 昵称输入：placeholder `请输入昵称`
  - 主按钮：`完成登录`（loading 文案 `登录中…`）
  - 提示：体验版/正式版说明

**校验/交互**
- 进入页面自动静默登录：
  - 成功且有 currentFamilyId：`reLaunch` 首页
  - 成功但无 currentFamilyId：`reLaunch` 家庭管理
- 手动登录：
  - 昵称必填；不能是“微信用户”
  - 头像必选
  - 上传头像到云存储后调用登录流程
  - 成功 toast：`登录成功`

**数据动作**
- 上传头像：`wx.cloud.uploadFile(cloudPath=avatars/login/...)`
- 登录：`familyFunctions.login(nickName, avatarUrl=fileID)`
- 拉家庭：`familyFunctions.getMyFamilies()`
- 初始化兜底：`initFunctions.init`

---

### 3) 家庭管理 `/pages/family/family/index`

**页面目标**：家庭列表（创建/加入/切换），以及家庭详情（成员、菜谱预览、邀请码、退出）。

**页面结构：两种模式**
- **A. 家庭列表**
  - 标题：`家庭管理`
  - 家庭卡片：家庭名 + `当前` 徽标 + 副文案（管理员/成员 | X个菜谱）
  - 空态：`暂无家庭，请创建或加入`
  - 底部按钮：`加入家庭`、主按钮 `创建家庭`
  - 弹窗（创建/加入共用）：输入 + `取消/确定`
- **B. 家庭详情**
  - 卡片 1：`家人`（头像、昵称、角色；支持加载与空态）
  - 卡片 2：`家庭菜谱`（数量、网格预览；支持加载与空态）
  - 卡片 3：`家庭管理`
    - 家庭邀请码 + `复制`
    - 危险按钮：`退出家庭`

**交互**
- 创建家庭：弹窗输入名称 → 确认 → 创建 → 刷新列表
- 加入家庭：弹窗输入邀请码 → 确认 → 加入 → 刷新列表
- 点击家庭卡片：切换家庭 → 进入详情并拉成员/菜谱
- 复制邀请码：写剪贴板 → toast `邀请码已复制`
- 退出家庭：退出后回列表

**数据动作**
- 家庭列表：`familyFunctions.getMyFamilies()`
- 统计菜谱数：`recipeFunctions.countRecipesByFamilyIds(familyIds[])`
- 切换家庭：`familyFunctions.switchFamily(familyId)`
- 成员：`familyFunctions.getFamilyMembers(familyId)`
- 菜谱：`recipeFunctions.listRecipes(familyId, keyword="")`
- 创建/加入/退出：`familyFunctions.createFamily/joinFamily/exitFamily`

---

### 4) 菜谱列表 `/pages/recipe/list/index`

**页面目标**：查看当前家庭菜谱；搜索；进入详情；长按编辑/删除。

**内容区块**
- 搜索框：`搜索菜名`
- `添加菜谱` 按钮
- 列表卡片：菜谱图 + 菜名 + 添加时间
- 空态：`暂无菜谱`
- 加载遮罩：`加载菜谱…`

**交互**
- 搜索输入：320ms 防抖刷新
- 点击卡片：进入详情 `/pages/recipe/detail/index?recipeId=...`
- 长按卡片：ActionSheet `编辑 / 删除`
  - 编辑：`/pages/recipe/edit/index?recipeId=...`
  - 删除：Modal `确认删除 / 删除后不可恢复` → 删除 → toast `删除成功` → 刷新

**数据动作**
- 列表：`recipeFunctions.listRecipes(familyId, keyword)`
- 删除：`recipeFunctions.deleteRecipe(recipeId)`

---

### 5) 添加菜谱 `/pages/recipe/add/index`

**页面目标**：创建菜谱；强约束“先填菜名”；支持链接兜底解析与多图 AI 导入；上传展示图；编辑并保存。

**内容区块（顺序）**
- Hero：`新增菜谱` / `先填菜名，再用链接/图片导入快速生成`
- 菜名（必填）
- 小红书链接导入（需解锁）
- 本地多图导入（AI识别）（需解锁）
- 菜品展示图（需解锁上传）
- 食材（至少 1）
- 调料（可选）
- 备菜步骤（至少 1）
- 做菜步骤（至少 1）
- 主按钮：`提交保存`

**关键交互/校验**
- `canImport`：菜名非空才解锁导入/上传
- 链接解析：校验 familyId + recipeName + url → 回填字段
- 多图导入：最多 9 张；单张 ≤10MB；上传后 AI 提取 → 回填字段
- 提交：必填 familyId/菜名/展示图；食材>=1；备菜/做菜步骤各>=1

**数据动作**
- 链接兜底：`aiFunctions.extractRecipe(xiaohongshuUrl, recipeName)`
- 多图识别：`aiFunctions.extractRecipeFromImage(recipeName, imageFileIds[])`
- 保存：`recipeFunctions.addRecipe(...)`

---

### 6) 编辑菜谱 `/pages/recipe/edit/index`

**页面目标**：编辑并保存（菜名、图、食材/调料/步骤）。

**内容区块**
- Hero：`编辑菜谱` / `调整信息后保存即可`
- 菜名输入
- 图片预览 + `重新上传图片`
- 食材/调料/备菜/做菜步骤编辑
- 主按钮：`保存`

**数据动作**
- 拉详情：`recipeFunctions.getRecipe(recipeId)`
- 保存：`recipeFunctions.updateRecipe(...)`

---

### 7) 菜谱详情 `/pages/recipe/detail/index`

**页面目标**：查看菜谱；从此发起点菜。

**内容区块**
- Hero：展示图 + 菜名
- 分区：`食材/调料/备菜步骤/做菜步骤`（各有空态）
- 主按钮：`点菜`

**交互（点菜确认弹窗）**
- 标题：`确认点这道菜吗？`
- 内容：`你可以在下一页添加口味偏好或食材替换备注（选填）。`
- 确认按钮：`确认点菜`
- 确认后：跳 `/pages/recipe/note/index?recipeId=...`

**数据动作**
- 详情：`recipeFunctions.getRecipe(recipeId)`

---

### 8) 点菜备注 `/pages/recipe/note/index`

**页面目标**：为点菜填写备注（可选）并加入当前待买菜点菜单。

**内容区块**
- 菜品卡片：图 + 菜名 + 提示 `添加到点菜单前，可写备注`
- 备注 textarea（max 200）：placeholder `可输入口味偏好、食材替换、制作要求等`
- 按钮：主按钮 `确认添加到点菜单`、次按钮 `取消`

**交互**
- 页面加载时：确保存在待买菜点菜单并拿到 `orderId`
- 点击确认：加入点菜单 → toast `添加成功` → 跳 `/pages/order/list/index`

**数据动作**
- 确保待买菜单：`orderFunctions.ensurePendingShoppingOrder(familyId)`
- 加入菜品：`orderFunctions.addRecipeToOrder(orderId, recipeId, note)`

---

### 9) 点菜单列表 `/pages/order/list/index`

**页面目标**：按状态查看点菜单；进入买菜/做菜/详情。

**内容区块**
- 顶部说明卡片：`点菜单` / `按状态查看与继续处理`
- Tabs：`待买菜 / 待制作 / 已完成`
- 列表卡片：点菜单名 + 徽标（进行中/完成）+ 创建时间
- 空态：`暂无点菜单`

**交互**
- 切 tab：刷新列表
- 点击订单：
  - 待买菜 → `/pages/shopping/shopping/index?orderId=...`
  - 待制作 → `/pages/cooking/cooking/index?orderId=...`
  - 已完成 → `/pages/order/detail/index?orderId=...`

**数据动作**
- 列表：`orderFunctions.listOrders(familyId, status)`

---

### 10) 点菜页 `/pages/order/choose/index`

**页面目标**：从菜谱库点菜；顶部展示当前待买菜单（含删菜）。

**内容区块**
- 顶部：`当前待买菜菜单`（含数量徽标、点菜单名、已点菜品列表）
  - 菜品行：菜名 + `by 昵称` + `删除`（仅待买菜状态）
  - 空态：`暂无已点菜品`
- 菜谱搜索：`搜索菜名`
- 菜谱卡片：图 + 菜名 + 两按钮 `跳过备注` / `备注`

**交互**
- `备注`：跳 `/pages/recipe/note/index?recipeId=...`
- `跳过备注`：直接加入待买菜单 → toast → 刷新顶部
- 删除菜品：
  - Modal：`确认删除 / 删除后将同步更新买菜清单。`
  - 若删后点菜单为空：再提示是否删除点菜单（`删除点菜单`）

**数据动作**
- 顶部待买菜单详情：`orderFunctions.getPendingShoppingOrderDetail(familyId)`
- 跳过备注加入：`orderFunctions.addRecipeToPendingShoppingOrder(familyId, recipeId, note="")`
- 删菜：`orderFunctions.removeRecipeFromPendingShoppingOrder(orderId, recipeId)`
- 删除空单：`orderFunctions.deleteOrderIfEmpty(orderId)`
- 菜谱列表：`recipeFunctions.listRecipes`

---

### 11) 点菜单详情 `/pages/order/detail/index`

**页面目标**：查看点菜单内菜品与备注；待买菜可删菜；进入买菜/做菜；继续加菜。

**内容区块**
- 点菜单名
- 状态：`状态：...`
- 菜品列表：菜名、点菜人、备注（可选）、删除按钮（仅待买菜）
- 底部按钮：
  - `继续加菜`（待买菜/待制作）
  - 主按钮 `去买菜`（待买菜）/ `去做菜`（待制作）
  - 已完成：`已完成（返回）`

**数据动作**
- 详情：`orderFunctions.getOrderDetail(orderId)`
- 删菜/删空单：同点菜页

---

### 12) 买菜清单 `/pages/shopping/shopping/index`

**页面目标**：归并采购项并勾选；手动加购；删手动项；继续加菜；完成买菜推进状态。

**内容区块**
- 头部：点菜单名 + 采购进度 + `返回`
- 归并列表 mergedItems：
  - checkbox + `名称（合计用量）` + `来自：...`
  - 右侧：`删除手动项`（仅待买菜、存在手动项、未全完成）
  - 空态：`暂无采购清单`
- 额外采购项（仅待买菜）：
  - 输入：名称、用量
  - `添加`、`继续加菜`、主按钮 `完成买菜`

**交互（关键弹窗）**
- 完成买菜：
  - 标题：`确认完成买菜`
  - 内容：`确认完成采购？完成后将无法加菜、删菜。`
  - 确认：`确认完成`

**数据动作**
- 清单：`checklistFunctions.getShoppingChecklist(orderId)`
- 勾选归并项：`checklistFunctions.markMergedItemsDone(orderId, itemIds[])`
- 手动加购：`checklistFunctions.addExtraShoppingItem(orderId, name, amount)`
- 删手动项：`checklistFunctions.removeManualShoppingItems(orderId, itemIds[])`
- 完成买菜：`checklistFunctions.completeShoppingOrder(orderId)`

---

### 13) 做菜清单 `/pages/cooking/cooking/index`

**页面目标**：按菜分组展示备菜/做菜步骤并勾选完成；支持折叠；全部完成后闭环。

**内容区块**
- 头部：点菜单名 + 进度（已完成/总步数）+ `返回`
- 分组 groups（默认展开）
  - 分组头：菜名 + `收起/展开`
  - 备注（可选）：`备注：...`
  - 子区：`备菜步骤`（checkbox 列表）、`做菜步骤`（checkbox 列表）

**交互**
- 勾选步骤：标记 done → 刷新
- 若本次勾选导致订单从待制作变为已完成：
  - 弹窗：`提示 / 确认已完成所有制作步骤吗？`
  - 确认后回首页
- 点击分组头：折叠/展开

**数据动作**
- 清单：`checklistFunctions.getCookingChecklist(orderId)`
- 勾选：`checklistFunctions.markCookingStepDone(stepId)`

---

## 云函数能力总览（用于把交互映射到后端动作）

- `familyFunctions`
  - `login / getMyFamilies / createFamily / joinFamily / switchFamily / getFamilyMembers / exitFamily / kickMember`
- `recipeFunctions`
  - `listRecipes / getRecipe / addRecipe / updateRecipe / deleteRecipe / countRecipesByFamilyIds / getTempFileURLs`
- `orderFunctions`
  - `ensurePendingShoppingOrder / addRecipeToOrder / addRecipeToPendingShoppingOrder / getPendingShoppingOrderDetail / listOrders / getOrderDetail / removeRecipeFromPendingShoppingOrder / deleteOrderIfEmpty / listFirstOrdersByStatuses ...`
- `checklistFunctions`
  - `getShoppingChecklist / markMergedItemsDone / addExtraShoppingItem / removeManualShoppingItems / completeShoppingOrder`
  - `getCookingChecklist / markCookingStepDone`
- `aiFunctions`
  - `extractRecipe`（小红书链接兜底校验后生成/补全结构）
  - `extractRecipeFromImage`（多图上传后百炼/Qwen 视觉提取结构化菜谱）

