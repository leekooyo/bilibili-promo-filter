// ==UserScript==
// @name         B站动态软广折叠
// @namespace    local.bilibili.dynamic.promo
// @version      2.2.1
// @updateURL    https://raw.githubusercontent.com/leekooyo/bilibili-promo-filter/main/bilibili-promo-filter.user.js
// @downloadURL  https://raw.githubusercontent.com/leekooyo/bilibili-promo-filter/main/bilibili-promo-filter.user.js
// @description  隐藏动态广告位和带货商品卡，并在本地按组合信号折叠疑似软广
// @match        https://t.bilibili.com/*
// @match        https://space.bilibili.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// ==/UserScript==

(() => {
    'use strict';

    const cardSelector = '.bili-dyn-list__item';
    const listSelector = '.bili-dyn-list__items';
    const goodsSelector = '.bili-dyn-card-goods';
    const footerSelector = '.bili-dyn-item__footer';
    const contentSelector = '.dyn-card-opus, .bili-dyn-card-article, .bili-dyn-content__orig__desc, .opus-module-content';
    const noticeSelector = '[data-bili-promo-notice]';
    const groupSelector = '[data-bili-promo-group]';
    const states = new WeakMap();
    const lists = new Map();
    const pending = new Set();
    const dirtyLists = new Set();
    let frame = 0;

    // Each category contributes at most once per content block.
    const signals = {
        price: /\d+(?:\.\d+)?\s*(?:元|块(?:钱)?)\s*(?:就能|就可|即可)?\s*(?:带走|拿下|入手|到手)|\d+(?:\.\d+)?\s*(?:元)?\s*无门槛|\d+(?:\.\d+)?\s*(?:元|块)?\s*一\s*(?:箱|盒|包|瓶|罐|袋)|(?:(?:到手|券后)(?:价|才|仅)?|只要|仅(?:需|售)?|特价)\s*(?:¥|💰)?\s*\d+(?:\.\d+)?(?![\d.盒包瓶罐袋件套])|(?:\d+(?:\.\d+)?\s*(?:元|块钱|左右)\s*到手)|(?:¥|💰)\s*\d|(?:满|领)?\s*\d{1,3}\s*(?:[-−减])\s*\d{1,3}\s*(?:的券|神券|红包|元)|\d+\s*(?:盒|包|瓶|罐|袋|件|粒|套)\s*(?:才|只要|仅需|到手价?)\s*\d/,
        copy: /(?:copy|[复複腹]制).{0,36}(?:领券|下单|购买|去.{0,14}买|\([\da-z]{6,}\)|[¥$￥][^¥$￥\n]{0,23}[a-z\d]{8,})/i,
        couponSearch: /(?:搜(?:索)?|嗖)(?:一下)?\s*[:：]?\s*(?:(?:【|\[)\s*)?\d{6}(?!\d)/,
        instantRetail: /外卖|闪购|外卖节|无门槛|神券|(?:领|大额).{0,6}红包/,
        checkout: /(?:直接|赶紧|抓紧|马上|现在)\s*(?:去\s*)?拍\s*\d+\s*(?:箱|盒|包|袋|瓶|罐|件|单|套|份)|(?:前往|速度去|赶紧去|快去).{0,16}(?:购买|下单|领券)|(?:点(?:击)?|打开).{0,12}(?:链接|小黄车).{0,6}(?:购买|下单|领券)|(?:领券后(?:再)?下单|拍下立减|有货.{0,5}(?:就|先|直接)拍|拍\s*(\d+)\s*(件|单|盒)[!、，,\s]+拍\s*\1\s*\2)/,
        rebate: /(?:收货|签收)\s*后?\s*(?:再|即|就)?\s*(?:返[现款]?|反|退)\s*(?:¥|💰)?\s*\d+(?:\.\d+)?\s*(?:元|块|红包)/,
        live: /(?:点进|进入|进|去)\s*直播间|直播间(?:专享|专属)(?:价|折扣|优惠)/,
        scarcity: /最后\s*\d+\s*(?:小时|单|份|件)|(?:仅剩|只剩|限量)\s*\d+\s*(?:单|份|件)|(?:补贴|优惠券?|红包).{0,8}(?:抢完就没|抢完即止|只剩)|(?:库存(?:不多|告急|.{0,5}掉得快)|(?:马上|即将|快要)\s*(?:断码|断货|售罄)|(?:尺码|库存|余货)\s*(?:已经|目前)?\s*(?:所剩无几|不多(?:了)?)|晚了就没|限时(?:抢购|秒杀|特价|优惠)|现货(?:速发|秒发)|售完即止)/,
        promotion: /特价|清仓|史低|大[漏陋]|降价|零头价|专享(?:价|折扣|优惠)|补贴|神券|无门槛|(?:奥莱|奥特莱斯).{0,10}降了|bug价/i,
        limitedOffer: /(?:只余|仅余|剩余|还剩|只剩|仅剩)\s*(?:最后)?\s*\d+\s*(?:个|份|件|单)?\s*(?:优惠名额|补贴名额|优惠券|券名额)|(?:优惠|补贴|领券)名额.{0,8}(?:发完即止|抢完就没|仅剩|只剩)/,
        urgency: /手慢(?:就没|无)|发完即止|抢完即止|抢完就没|晚了就没|抓紧(?:领取|下单|抢)|限时(?:领取|抢购)/,
        giveaway: /评论区\s*(?:随机)?抽.{0,12}(?:粉丝|名|位).{0,10}补贴\s*(?:¥|💰)?\s*\d/,
        repeatedPrice: /(\d+\s*(?:盒|包|瓶|罐|袋|件|套)\s*到手(?:价)?\s*\d+(?:\.\d+)?)[!、，,\s]+\1(?![\d.])/,
        sellerPrice: /(?:原价|专柜(?:价)?|门店(?:价)?|别家|其他平台|某[\u4e00-\u9fff]{1,4})\s*(?:售价|卖|要)?\s*(?:¥|💰)?\s*\d+(?:\.\d+)?\s*(?:多|元|块)?\s*[,;、]\s*(?:咱们|我们|本店|店里)(?:这边)?\s*(?:仅(?:需|售)?|只要|到手(?:价)?|特价)\s*(?:¥|💰)?\s*\d+(?:\.\d+)?\s*(?:元|块)/,
        retailTerms: /(?:赠送?|送|包)\s*(?:运费险|[芸云]费险)/,
        stockOptions: /(?:尺码|男女码|款式|颜色).{0,10}(?:都有|齐全|可选|任选|现货)|(?:奥莱|奥特莱斯).{0,10}(?:降了|降价|清仓)/,
        discussion: /防骗(?:提醒|经历|指南)?|骗局|骗子|辟谣|求问|是真的吗|(?:购物|操作)教程|(?:个人|二手)转卖|二手转售|仅供讨论|引用(?:一下|如下)|售后对比|退货体验/,
    };

    function classify(text) {
        const hit = {};
        for (const [name, pattern] of Object.entries(signals)) {
            hit[name] = pattern.test(text);
        }

        let score = 0;
        const reasons = [];
        function add(found, weight, label) {
            if (found) {
                score += weight;
                reasons.push(label);
            }
        }

        const search = hit.couponSearch && hit.instantRetail;
        const directing = hit.copy || search || hit.checkout;
        const seller = hit.sellerPrice && hit.retailTerms && hit.stockOptions;
        const offer = hit.price || hit.sellerPrice;
        const rebateDeal = hit.rebate && (hit.live || hit.scarcity);
        const repeated = hit.repeatedPrice && hit.giveaway;
        const stockDeal = hit.giveaway && hit.scarcity && hit.checkout;
        const limitedDeal = hit.limitedOffer && hit.urgency;
        add(offer, 2, '报价');
        add(directing, hit.copy || search ? 4 : 2, '购买或领取指令');
        add(hit.rebate, 2, '收货返现');
        add(hit.live, 2, '直播引导');
        add(hit.scarcity, 2, '限时或库存');
        add(hit.promotion, 1, '促销措辞');
        add(hit.giveaway, 1, '评论区抽补贴');
        add(hit.repeatedPrice, 3, '重复报价');
        add(seller, 4, '卖家报价与售卖条件');
        add(limitedDeal, 4, '优惠名额与催促');

        const actionable = directing || rebateDeal || repeated || stockDeal || seller || limitedDeal;
        const high = score >= 6 && offer && actionable && !hit.discussion;
        const commercial = offer && (directing || hit.rebate || (hit.scarcity && hit.promotion));
        return { level: high ? 2 : score >= 4 ? 1 : 0, score, reasons, commercial };
    }

    const storageKey = 'bili-promo-feedback-v1';
    const maxSamples = 120;
    let samples = [];
    let postings = new Map();

    function hash(text, seed = 2166136261) {
        let value = seed;
        for (let index = 0; index < text.length; index++) {
            value = Math.imul(value ^ text.charCodeAt(index), 16777619);
        }
        return value >>> 0;
    }

    function fingerprint(text) {
        return hash(text).toString(36) + '-' + hash(text, 5381).toString(36);
    }

    function features(text) {
        // Ignore order numbers, coupon codes, and punctuation while comparing phrasing.
        const words = text.slice(0, 800).toLowerCase().match(/\p{L}+/gu) ?? [];
        const grams = new Set();
        for (const word of words) {
            for (const length of [2, 3]) {
                for (let index = 0; index + length <= word.length; index++) {
                    grams.add(hash(word.slice(index, index + length)));
                }
            }
        }
        return [...grams];
    }

    function readSamples(value) {
        if (!Array.isArray(value)) return [];
        return value.slice(-maxSamples).filter(sample => sample &&
            typeof sample.key === 'string' && typeof sample.signature === 'string' && typeof sample.ad === 'boolean' &&
            Array.isArray(sample.grams) && sample.grams.length <= 1600 &&
            sample.grams.every(Number.isInteger));
    }

    function rebuild(value) {
        samples = readSamples(value);
        postings = new Map();
        // Reposts stay individually marked, but each text signature counts once when learning.
        const representatives = new Map();
        for (const sample of samples) {
            if (!representatives.has(sample.signature)) {
                representatives.set(sample.signature, sample);
            } else if (representatives.get(sample.signature)?.ad !== sample.ad) {
                representatives.set(sample.signature, null);
            }
        }
        for (const sample of representatives.values()) {
            if (!sample) continue;
            for (const gram of sample.grams) {
                if (!postings.has(gram)) postings.set(gram, []);
                postings.get(gram).push(sample);
            }
        }
    }

    function similarity(grams) {
        const counts = new Map();
        for (const gram of grams) {
            for (const sample of postings.get(gram) ?? []) {
                counts.set(sample, (counts.get(sample) ?? 0) + 1);
            }
        }
        const positive = [];
        let negative = 0;
        for (const [sample, count] of counts) {
            const score = count / Math.sqrt(grams.length * sample.grams.length);
            if (sample.ad) {
                positive.push(score);
            } else {
                negative = Math.max(negative, score);
            }
        }
        positive.sort((a, b) => b - a);
        return { first: positive[0] ?? 0, second: positive[1] ?? 0, negative };
    }

    function personalize(baseline, text, key) {
        const direct = samples.find(sample => sample.key === key);
        if (direct) {
            return { level: direct.ad ? 2 : 0, score: baseline.score,
                reasons: [direct.ad ? '你标记为广告' : '你标记为普通动态'] };
        }
        if (!samples.length || !text) return baseline;
        const { first, second, negative } = similarity(features(text));
        if (baseline.level === 2 && negative >= 0.60 && negative > first + 0.08) {
            return { ...baseline, level: 1, reasons: [...baseline.reasons, '类似你保留的内容'] };
        }
        if (baseline.level === 2 || signals.discussion.test(text) || first <= negative + 0.12) return baseline;
        if ((second >= 0.40 && first >= 0.50) ||
            (baseline.level === 1 && baseline.commercial && second >= 0.37 && first >= 0.48)) {
            return { level: 2, score: baseline.score, reasons: [...baseline.reasons, '类似你标记的广告'] };
        }
        if (baseline.level === 0 && first >= 0.42) {
            return { level: 1, score: baseline.score, reasons: ['类似你标记的广告'] };
        }
        return baseline;
    }

    function saveFeedback(state, ad) {
        const next = readSamples(GM_getValue(storageKey, [])).filter(sample => sample.key !== state.key);
        if (ad !== null) {
            const grams = features(state.text);
            const signature = fingerprint(grams.slice().sort((a, b) => a - b).join(','));
            next.push({ key: state.key, ad, signature, grams });
        }
        const bounded = next.slice(-maxSamples);
        GM_setValue(storageKey, bounded);
        rebuild(bounded);
        refreshFeed();
    }

    rebuild(GM_getValue(storageKey, []));


    GM_addStyle(
        '.bili-dyn-ads, ' + cardSelector + ':has(' + goodsSelector + ') { display: none !important; }' +
        cardSelector + '[data-bili-promo-state="collapsed"] { display:none !important; }' +
        groupSelector + ' { margin-block-end:4px; }' +
        groupSelector + ' button { display:block; width:100%; text-align:start; padding:3px 10px;' +
        'font-size:12px; line-height:1.5; border:0; border-radius:6px; cursor:pointer;' +
        'color:var(--text2,#61666d); background:var(--bg2,#f1f2f3); }' +
        footerSelector + ':has(> ' + noticeSelector + ') { height:auto; min-height:50px; flex-wrap:wrap; column-gap:8px; }' +
        noticeSelector + ' { align-self:center; min-inline-size:0; max-inline-size:100%;' +
        'font-size:12px; line-height:1.5; color:var(--text2,#61666d); }' +
        cardSelector + ' > ' + noticeSelector + ' { display:flex; justify-content:flex-end; padding:4px 12px; }' +
        noticeSelector + ' summary { cursor:pointer; color:inherit; border-radius:4px; padding:0 4px; background:var(--bg1,#fff); }' +
        noticeSelector + ' details > div { max-inline-size:230px; margin-block:4px; padding:4px;' +
        'border:1px solid var(--line_regular,#c9ccd0); border-radius:6px; background:var(--bg1,#fff); }' +
        noticeSelector + ' span[hidden] + br { display:none; }' +
        noticeSelector + ' button:not([hidden]) { margin:3px 3px 0 0;' +
        'cursor:pointer; color:var(--text-link,#087f9f); background:var(--bg1,#fff);' +
        'border:1px solid var(--line_regular,#c9ccd0); border-radius:6px; padding:3px 9px;' +
        '}'
    );

    function contentBlocks(card) {
        const blocks = [];
        for (const element of card.querySelectorAll(contentSelector)) {
            if (element.closest(cardSelector) !== card || element.parentElement.closest(contentSelector)) continue;
            blocks.push(element.textContent.normalize('NFKC').replace(/[\u200b-\u200f\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim());
        }
        return blocks;
    }

    function strongest(blocks) {
        let best = { level: 0, score: 0, reasons: [], text: "" };
        for (const text of blocks) {
            const result = classify(text);
            if (result.level > best.level || (result.level === best.level && result.score > best.score) || (result.score === best.score && result.level === best.level && text.length > best.text.length)) {
                best = { ...result, text };
            }
        }
        return best;
    }

    function clear(card, previous) {
        card.removeAttribute('data-bili-promo-state');
        if (previous) previous.notice.remove();
        states.delete(card);
    }

    function makeButton(label, action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', event => {
            event.stopPropagation();
            action();
        });
        return button;
    }

    function draw(card, state) {
        const high = state.result.level === 2;
        const active = state.result.level > 0;
        const mode = high ? (state.expanded ? 'expanded' : 'collapsed') : 'suspected';
        if (active) card.setAttribute('data-bili-promo-state', mode);
        else card.removeAttribute('data-bili-promo-state');
        const description = active ? state.result.reasons.join('、') :
            state.feedback === false ? '已标记为普通动态' : '';
        const summary = active ? '疑似推广' : '推广标记';
        if (state.summary.textContent !== summary) state.summary.textContent = summary;
        if (state.label.textContent !== description) state.label.textContent = description;
        state.label.hidden = !description;
        state.undo.hidden = state.feedback === undefined;
    }

    function refresh(card, feedbackChanged = false) {
        let state = states.get(card);
        if (!card.isConnected || card.querySelector(goodsSelector)) {
            if (state) clear(card, state);
            return state?.result.level === 2;
        }
        const blocks = contentBlocks(card);
        if (!blocks.some(Boolean)) {
            if (state) clear(card, state);
            return state?.result.level === 2;
        }
        const sameText = state && blocks.length === state.blocks.length &&
            blocks.every((text, index) => text === state.blocks[index]);
        const baseline = sameText ? state.baseline : strongest(blocks);
        const identity = card.querySelector('.dyn-card-opus__title[data-url], .bili-dyn-card-article[href]');
        const link = identity?.getAttribute('data-url') ?? identity?.getAttribute('href');
        const key = fingerprint(link ? 'post:' + link.replace(/^https?:/, '').split(/[?#]/)[0] : 'text:' + baseline.text);
        if (state && state.key !== key && link) state.expanded = false;
        const wasHigh = state?.result.level === 2;
        const mount = card.querySelector(footerSelector) ?? card;
        if (sameText && state.key === key && !feedbackChanged) {
            if (state.notice.parentElement !== mount) mount.append(state.notice);
            return false;
        }
        if (!state) {
            const notice = document.createElement('div');
            const label = document.createElement('span');
            const details = document.createElement('details');
            const summary = document.createElement('summary');
            const panel = document.createElement('div');
            notice.setAttribute('data-bili-promo-notice', '');
            summary.textContent = '推广标记';
            details.append(summary, panel);
            notice.append(details);
            notice.addEventListener('click', event => event.stopPropagation());
            state = { notice, label, summary, expanded: false };
            state.undo = makeButton('撤销标记', () => saveFeedback(state, null));
            panel.append(label, document.createElement('br'), makeButton('这是广告', () => {
                details.open = false;
                saveFeedback(state, true);
            }), makeButton('这不是广告', () => {
                details.open = false;
                saveFeedback(state, false);
            }), state.undo);
            states.set(card, state);
        }
        if (state.notice.parentElement !== mount) mount.append(state.notice);
        state.blocks = blocks;
        state.baseline = baseline;
        state.key = key;
        state.text = baseline.text;
        state.feedback = samples.find(sample => sample.key === key)?.ad;
        state.result = personalize(baseline, state.text, key);
        if (state.result.level !== 2) state.expanded = false;
        draw(card, state);
        return wasHigh !== (state.result.level === 2);
    }

    function drawGroup(group) {
        const label = group.cards.length + ' 条疑似推广';
        const description = group.open ? '收起 ' + label : '已折叠 ' + label + ' · 展开';
        if (group.button.textContent !== description) group.button.textContent = description;
        group.button.setAttribute('aria-expanded', String(group.open));
        for (const card of group.cards) {
            const state = states.get(card);
            if (state.expanded === group.open) continue;
            state.expanded = group.open;
            draw(card, state);
        }
    }

    function regroup(list) {
        const info = lists.get(list);
        const next = new Map();
        let run = [];
        function finishRun() {
            if (!run.length) return;
            const first = run[0];
            let group = info.groups.get(first);
            if (!group) {
                const row = document.createElement('div');
                row.setAttribute('data-bili-promo-group', '');
                group = { row };
                group.button = makeButton('', () => {
                    group.open = !group.open;
                    drawGroup(group);
                });
                row.append(group.button);
            }
            group.cards = run;
            group.open = run.some(card => states.get(card).expanded);
            if (first.previousElementSibling !== group.row) first.before(group.row);
            next.set(first, group);
            drawGroup(group);
            run = [];
        }
        for (const child of [...list.children]) {
            if (child.matches(groupSelector)) continue;
            if (states.get(child)?.result.level === 2) run.push(child);
            else finishRun();
        }
        finishRun();
        for (const [first, group] of info.groups) if (!next.has(first)) group.row.remove();
        info.groups = next;
    }

    function flush() {
        frame = 0;
        for (const card of pending) {
            const list = card.parentElement;
            if (lists.has(list) && refresh(card)) dirtyLists.add(list);
        }
        pending.clear();
        for (const list of dirtyLists) if (lists.has(list)) regroup(list);
        dirtyLists.clear();
    }

    function schedule() {
        if (!frame && (pending.size || dirtyLists.size)) frame = requestAnimationFrame(flush);
    }

    function watch(list) {
        if (lists.has(list)) return;
        const observer = new MutationObserver(records => {
            for (const record of records) {
                const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
                if (!target || target.closest(noticeSelector + ', ' + groupSelector)) continue;
                if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(
                    node => node.nodeType === 1 && node.matches(noticeSelector + ', ' + groupSelector))) continue;
                if (target === list) {
                    for (const node of [...record.addedNodes, ...record.removedNodes]) {
                        if (node.nodeType !== 1 || node.matches(groupSelector)) continue;
                        if (node.matches(cardSelector) && node.parentElement === list) pending.add(node);
                        dirtyLists.add(list);
                    }
                } else {
                    const card = target.closest(cardSelector);
                    if (card?.parentElement === list) pending.add(card);
                }
            }
            schedule();
        });
        lists.set(list, { observer, groups: new Map() });
        for (const child of list.children) if (child.matches(cardSelector)) refresh(child);
        regroup(list);
        observer.observe(list, {
            subtree: true, childList: true, characterData: true,
            attributes: true, attributeFilter: ['data-url', 'href'],
        });
    }

    function discover(root) {
        if (root.matches(listSelector)) watch(root);
        for (const list of root.querySelectorAll(listSelector)) watch(list);
        if (root.matches(cardSelector) && root.parentElement) watch(root.parentElement);
        for (const card of root.querySelectorAll(cardSelector)) watch(card.parentElement);
    }

    function refreshFeed() {
        for (const list of lists.keys()) {
            for (const card of list.children) if (card.matches(cardSelector)) refresh(card, true);
            regroup(list);
        }
    }

    discover(document.body);
    const discovery = new MutationObserver(records => {
        for (const [list, info] of lists) {
            if (list.isConnected) continue;
            info.observer.disconnect();
            for (const group of info.groups.values()) group.row.remove();
            lists.delete(list);
        }
        for (const record of records) {
            if (record.target.closest?.(listSelector + ', ' + cardSelector + ', ' + noticeSelector + ', ' + groupSelector)) continue;
            for (const node of record.addedNodes) {
                if (node.nodeType === 1 && node.isConnected) discover(node);
            }
        }
    });
    discovery.observe(document.body, { subtree: true, childList: true });

    GM_addValueChangeListener(storageKey, (_key, _previous, value, remote) => {
        if (remote) {
            rebuild(value);
            refreshFeed();
        }
    });
})();
