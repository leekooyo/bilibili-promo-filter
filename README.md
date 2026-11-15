# B 站动态去广告

一个 Tampermonkey 用户脚本。它隐藏动态广告位和商品卡，并在浏览器本地折叠疑似推广。折叠内容可以展开，分类结果可以手动纠正。

## 使用

打开 [安装或更新脚本](https://raw.githubusercontent.com/leekooyo/bilibili-promo-filter/main/bilibili-promo-filter.user.js)，在 Tampermonkey 的安装页面选择安装或更新，再刷新 B 站动态页。已有的同名脚本等原位更新后，Tampermonkey 会按自身设置检查后续版本。

## 维护

直接修改 `bilibili-promo-filter.user.js`。发布前更新脚本头部的 `@version`，并在动态页检查折叠、展开和推广标记。安装文件就是这个脚本，无需构建。
