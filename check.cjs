const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { runInNewContext } = require('node:vm');

const script = readFileSync(join(__dirname, 'bilibili-promo-filter.user.js'), 'utf8');
const startup = script.indexOf('\n    GM_addStyle(');
assert.ok(startup > 0, 'Userscript must initialize its rules before mounting the interface');
let rules;
runInNewContext(script.slice(0, startup) + '\n expose({ classify, feedbackIdentity, fingerprint, postKeys });\n})();', {
    URL, crypto: webcrypto, location: new URL('https://t.bilibili.com/'),
    GM_getValue: (_key, fallback) => fallback,
    expose: functions => { rules = functions; },
});

function cardWithLink(link, isReference = false) {
    const card = {
        querySelector: () => null,
        querySelectorAll: () => link ? [identity] : [],
    };
    const identity = {
        closest(selector) {
            return selector === '.bili-dyn-list__item' ? card : isReference ? {} : null;
        },
        getAttribute: () => link,
    };
    return card;
}

test('Unlinked corrections survive text expansion and belong to one card', () => {
    const card = cardWithLink();
    const initial = { element: {}, text: '这是正文预览… 全文' };
    const identity = rules.feedbackIdentity(card, initial);
    const state = { ...identity, key: identity.keys[0], baseline: initial };
    const expanded = { ...initial, text: '这是正文预览。补充全文。 收起' };
    assert.equal(rules.feedbackIdentity(card, expanded, state).keys[0], state.key);
    assert.notEqual(rules.feedbackIdentity(cardWithLink(), initial).keys[0], state.key);
    assert.notEqual(rules.feedbackIdentity(card, { ...initial, text: '一条不同的动态' }, state).keys[0], state.key);
});

test('Permalink variants share a key and the old permalink remains a lookup key', () => {
    const id = '1000000000000000001';
    const opus = rules.postKeys(cardWithLink('//www.bilibili.com/opus/' + id + '?ref=sample'));
    const dynamic = rules.postKeys(cardWithLink('https://t.bilibili.com/' + id));
    assert.equal(opus[0], dynamic[0]);
    assert.ok(opus.includes(rules.fingerprint('post://www.bilibili.com/opus/' + id)));
    assert.ok(opus.includes(rules.fingerprint('post://t.bilibili.com/' + id)));
    assert.equal(rules.postKeys(cardWithLink('//www.bilibili.com/opus/' + id, true)).length, 0);
});

test('Selected keyword combinations distinguish promotions from ordinary posts', () => {
    for (const [text, expected, forward = false] of [
        ['仅需30秒，复制这段代码 (example123) 即可运行。', 0],
        ['聊聊京东和淘宝的售后体验。', 0],
        ['29.9元包邮，点评论区置顶链接下单。', 2],
        ['外卖搜密令【268496】，20元无门槛。', 2],
        ['别再买闷汗的打底衫了！吸湿排汗，防静电，性价比直接拉满！', 2, true],
        ['别再买硬坐垫了！贴合腰背，角度可调，性价比拉满，下面是我的自费实测。', 0, true],
    ]) {
        assert.equal(rules.classify(text.normalize('NFKC'), forward).level, expected, text);
    }
});
