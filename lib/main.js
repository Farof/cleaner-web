let pageMod = require('sdk/page-mod');
let self = require('sdk/self');
let data = self.data;
let cm = require('sdk/context-menu');
let simplePrefs = require('sdk/simple-prefs');
let prefs = simplePrefs.prefs;
let str = require('sdk/l10n').get;
let ss = require('sdk/simple-storage').storage;

Object.defineProperties(Object, {
  forEach: {
    value: function (obj, fn) {
      Object.keys(obj).forEach(key => {
        fn(obj[key], key, obj);
      });
    }
  },

  map: {
    value: function (obj, fn) {
      let o = {};
      Object.keys(obj).forEach(key => {
        o[key] = fn(obj[key], key, obj);
      });
      return o;
    }
  }
});

let conf = {
  'lemonde.fr': {
    include: '*.lemonde.fr',
    mods: ['ads', 'comment', 'nav', 'social', 'subscribe', 'toolbar']
  }
};

function bootstrapConf () {
  ss.version = self.version;
  if (!ss.websites) ss.websites = {};

  for (let website in conf) {
    let rule = conf[website];
    if (!ss.websites[website]) ss.websites[website] = { sections: {} };

    let mods = {};
    rule.mods.forEach(section => {
      if (ss.websites[website].sections[section] == undefined) ss.websites[website].sections[section] = true;
      mods[section] = {
        ref: null,
        options: {
          include: rule.include,
          attachTo: ['top', 'existing'],
          contentStyleFile: data.url(['userstyles', website, section + '.css'].join('/'))
        }
      };
    });
    rule.mods = mods;
  }

  for (let website in ss.websites) {
    if (!conf[website]) {
      delete ss.websites[website];
    }
  }
}

/* MOD */
function attachMod(mod, website, section) {
  mod.ref = pageMod.PageMod(mod.options);
}

function detachMod(mod, website, section) {
  mod.ref.destroy();
  mod.ref = null;
}

function toggleMod(rule, website, section) {
  let mod = rule.mods[section];
  if (mod.ref) detachMod(mod, website, section);
  else attachMod(mod, website, section);
  ss.websites[website].sections[section] = !!mod.ref;
}

/* CONTEXT MENU */
function getCMLabel(website, section) {
  return '(' + (ss.websites[website].sections[section] ? 'x' : '-') + ') ' + str(section);
}

function attachCM(rule, website) {
  let ctx = cm.URLContext(rule.include);
  rule.cm = cm.Menu({
    context: ctx,
    label: str('CW'),
    contentScript: 'self.on("click", (node, data) => self.postMessage(data));',
    onMessage: (section) => {
      toggleMod(rule, website, section);
      rule.cm.items[Object.keys(rule.mods).indexOf(section)].label = getCMLabel(website, section);
    },
    items: Object.keys(rule.mods).map(section => {
      return cm.Item({
        label: getCMLabel(website, section),
        data: section
      });
    })
  });
}

function detachCM(rule) {
  rule.cm.destroy();
  rule.cm = null;
}

function attachAllCM() {
  for (let website in conf) {
    let rule = conf[website];
    if (!rule.cm) attachCM(rule, website);
  }
}

function detachAllCM() {
  for each (let rule in conf) {
    if (rule.cm) detachCM(rule);
  }
}

/* WEBSITE */
function attachWebsite(website, rule) {
  for (let section in rule.mods) {
    let mod = rule.mods[section];
    if (!mod.ref && ss.websites[website].sections[section]) attachMod(mod, website, section);
  }

  if (prefs.showContextMenu && !rule.cm) {
    attachCM(rule, website)
  }
}

function detachWebsite(website, rule) {
  for (let section in rule.mods) {
    let mod = rule.mods[section];
    if (mod.ref) {
      detachMod(mod, website, section);
    }
  }

  if (rule.cm) {
    detachCM(rule);
  }
}

function attachAll() {
  for (let website in conf) {
    attachWebsite(website, conf[website]);
  }
}

function detachAll() {
  for (let website in conf) {
    detachWebsite(website, conf[website]);
  }
}

/* UI */
function getWidgetTooltip() {
  return str(prefs.isEnabled ? 'CW_tooltip_on' : 'CW_tooltip_off');
}

function getWidgetContent() {
  return str(prefs.isEnabled ? 'CW_content_on' : 'CW_content_off')
}

function setupUI() {
  let widget = require('sdk/widget').Widget({
    id: 'cleanerWebWidget',
    label: str('CW_toggle'),
    tooltip: getWidgetTooltip(),
    content: getWidgetContent(),
    width: 40,
    onClick: () => prefs.isEnabled = !prefs.isEnabled
  });

  simplePrefs.on('isEnabled', name => {
    widget.content = getWidgetContent();
    widget.tooltip = getWidgetTooltip();
  });
}

/* INIT */
function init() {
  bootstrapConf();
  setupUI();

  simplePrefs.on('isEnabled', () => prefs.isEnabled ? attachAll() : detachAll());
  simplePrefs.on('showContextMenu', () => prefs.showContextMenu ? attachAllCM() : detachAllCM());

  // simplePrefs.on('configuration', name => {
  //   console.log('configuration');
  // });

  if (prefs.isEnabled) {
    attachAll();
  }

  console.log(self.name + ' (' + self.version + ') started.');
}

init();
