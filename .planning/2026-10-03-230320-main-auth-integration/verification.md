# main 首页与账号入口对接验收

实际记录时间：2026-10-03T23:33:48+08:00（北京时间）。

## 更新与保留

已 git fetch origin main；远端从0e892fa更新至bd1d478。修改前将受版本控制的改动、src/、tests/、frontend/ 备份到本目录 originals/ 并记录 paths.json、git-status.txt、原HEAD。main 通过 git merge --ff-only origin/main 快进到bd1d478；git stash apply 恢复原本地修改，README及文档总览的重叠内容逐项保留并解决冲突。恢复原未暂存状态，stash 备份仍保留。当前在 codex/main-auth-integration 分支；无新提交、推送或部署。

## 接入范围

复用main的frontend/完整首页、AuthForm、ApiClient与账号样式，新增personal.html生产构建入口。src/server.py可用--with-auth启动同源首页、注册、登录和/files文件Agent。main既有FormalApp及backend/账号接口未改写；本次是接到现有src/后端的独立本机账号，账号库与PostgreSQL版本独立。

src/accounts.py保存SQLite本机账号，密码经scrypt加盐哈希，持久会话仅存随机令牌哈希与到期时间；HttpOnly/SameSite Cookie、一次性匿名CSRF、登录尝试限制、退出撤销会话。文件API仍需要账户及本机Token双重校验。每个账号创建独立WorkspaceApplication、MemoryStore、COSStore和模型覆盖；已有单用户数据未导入。localStorage界面状态也按账号区分。

8789使用var/accounts/独立运行目录、现有受控模型配置。8787与8788未停止或重启，检查时仍各有2和12个工作区。新注册账号起始为空；原数据仍从原地址查看。临时文件依然需要启用COS才能跨服务重启恢复。

## TDD与实际验证

- 新增4项HTTP账户集成测试，改动前因缺少with_auth入口失败；实现后通过。覆盖注册、登录、错误密码、重名账号、密码不明文落盘、会话重载、CSRF与跨站、Cookie属性、退出失效、跨账号文件与档案隔离。
- .venv/bin/python -m unittest discover -s tests -v：87项通过（4项新增+83项原测试）。
- CSP调整后 tests.test_auth_integration 与 tests.test_http：14项通过。
- npm --prefix front test -- --run src/features/auth/AuthForm.test.tsx src/shared/api.test.ts src/features/home/intro-integration.test.ts：16项通过。第一次首页监听受沙箱限制；申请本机监听权限后通过，不将最初失败记为通过。
- npm --prefix front run build：类型编译与三入口生产构建通过。
- node --check src/web/app.js 与 git diff --check：通过。
- tests/auth_browser.cjs：4组完整流程通过，使用8792隔离服务、合成账号与通知、真实HTTP传输的模型替身及COS替身。覆盖首页进入注册/登录、上传、增量显示、沉淀编辑后重新解读、原文弹窗、导出、COS替身保存、退出撤销、第二账号隔离、重新登录继续、新会话共享本人沉淀、错误密码及重复注册、手机无溢出。

浏览器首轮导出断言安排在沉淀修改导致旧回复失效之后，已修正测试为重新解读后导出；未绕过原失效保护。一次路由切换测试因未等登录界面就绪而超时，已明确等待标题后通过。截图发现手机返回首页与Logo重叠，先加入断言确认失败，添加仅作用于personal入口的顶部留白后通过。

auth-home.png、auth-login.png、auth-workspace.png、auth-mobile.png为合成数据截图；已查看登录与手机布局。没有发送真实用户文件或档案给模型，未将替身作为真实LLM/COS验收。

## 已启动入口

实际运行 ./run.sh --with-auth --port 8789 --data-dir var/accounts。
只读HTTP检查：8789的/重定向/intro/且首页完整、/login提供构建结果、注册已开放；8787/8788仍返回200。模型配置权限0600且位于Git忽略目录，没有打印密钥。

## 未验证或缺失

main 指定的100秒介绍视频原件及 frontend/project-video.mp4 在本机均不存在；已在项目及父项目目录搜索，只有其他旧宣传片，不混用。首页章节、动效与登录入口可用，介绍视频播放未恢复。真实模型与真实 COS 在本轮没有新增外发验收；原有服务和资料未发送或迁移。
