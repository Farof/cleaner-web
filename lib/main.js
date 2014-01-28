"use strict";

const pageMod = require('sdk/page-mod');
const self = require('sdk/self');
const data = self.data;
const cm = require('sdk/context-menu');
const simplePrefs = require('sdk/simple-prefs');
const prefs = simplePrefs.prefs;
const str = require('sdk/l10n').get;
const ss = require('sdk/simple-storage').storage;
const Request = require('sdk/request').Request
const { indexedDB } = require('sdk/indexed-db');
const tabs = require('sdk/tabs');
const { defer, all } = require('sdk/core/promise');

/* augmentation */
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

Object.defineProperties(Array.prototype, {
  contains: {
    value: function (item) {
      return this.indexOf(item) > -1;
    }
  }
});

let cw = {
  init: () => {
    let deferred = defer();

    cw.ui.init();
    cw.page.init();

    simplePrefs.on('isEnabled', () => prefs.isEnabled ? cw.mod.attachAll() : cw.mod.detachAll());
    simplePrefs.on('showContextMenu', () => prefs.showContextMenu ? cw.contextMenu.attachAll() : cw.contextMenu.detachAll());
    simplePrefs.on('configuration', cw.page.open);

    // loadRemote();

    cw.db.init().then(cw.remote.updateAll, ev => {
      console.log('error initialiazing Cleaner Web database: ', ev.target.error.name);
      deferred.reject();
    }).then(() => {
      if (prefs.isEnabled) {
        cw.mod.attachAll();
      }

      deferred.resolve();
    });

    return deferred.promise;
  },

  /* DATABASE */
  db: {
    ref: null,

    onerror: ev => console.log('db error: ', ev.target.error.name),

    init: () => {
      let deferred = defer();
      let request = indexedDB.open('userstyles', '15');

      request.onupgradeneeded = ev => {
        console.log('upgrading db');

        let db = ev.target.result;
        ev.target.transaction.onerror = cw.db.onerror;

        // mods
        if (db.objectStoreNames.contains('mods')) {
          db.deleteObjectStore('mods');
        }
        let modsStore = db.createObjectStore('mods', { keyPath: 'uid' });
        // modsStore.createIndex('source', 'source');
        // modsStore.createIndex('pattern', 'pattern');

        // remotes
        if (db.objectStoreNames.contains('remotes')) {
          db.deleteObjectStore('remotes');
        }
        let remotes = ['https://raw.github.com/Farof/userstyles/master'];
        // let remotes = ['http://127.0.0.1:8090'];
        let remotesStore = db.createObjectStore('remotes', { keyPath: 'url' });
        for (let remote of remotes) {
          remotesStore.add({ url: remote });
        }
      };

      request.onsuccess = ev => {
        cw.db.ref = ev.target.result;
        cw.db.ref.onerror = cw.db.onerror;

        deferred.resolve(cw.db.ref);
      };

      request.onerror = deferred.reject;

      return deferred.promise;
    },

    transaction: (storeName, mode = 'readonly') => cw.db.ref.transaction(storeName, mode),
    store: (storeName, mode = 'readonly') => cw.db.transaction(storeName, mode).objectStore(storeName),
    cursor: (storeName, mode = 'readonly') => cw.db.store(storeName, mode).openCursor(),

    // storeKeyPath: storeName => cw.db.store(storeName).keyPath,

    each: (storeName, fn, mode = 'readonly') => {
      let deferred = defer();

      cw.db.cursor(storeName, mode).onsuccess = ev => {
        let cursor = ev.target.result;
        if (cursor) {
          fn(cursor);
          cursor.continue();
        } else {
          deferred.resolve();
        }
      };

      return deferred.promise;
    },

    getAllKeys: storeName => {
      let deferred = defer();
      let keys = [];

      cw.db.each(storeName, cursor => {
        keys.push(cursor.key);
      }).then(() => deferred.resolve(keys));

      return deferred.promise;
    },

    get: (storeName, key, mode = 'readonly') => {
      let deferred = defer();
      let req = cw.db.store(storeName, mode).get(key);

      req.onsuccess = ev => deferred.resolve([ev.target.result, ev.target.source]);
      req.onerror = deferred.reject;

      return deferred.promise;
    },

    add: (storeName, obj) => {
      let deferred = defer();
      let req = cw.db.store(storeName, 'readwrite').add(obj);

      req.onsuccess = () => deferred.resolve(obj);
      req.onerror = deferred.reject;

      return deferred.promise;
    },

    put: (storeName, obj) => {
      let deferred = defer();
      let req = cw.db.store(storeName, 'readwrite').put(obj);

      req.onsuccess = () => deferred.resolve(obj);
      req.onerror = deferred.reject;

      return deferred.promise;
    },

    delete: (storeName, key) => {
      let deferred = defer();
      let req = cw.db.store(storeName, 'readwrite').delete(key);

      req.onsuccess = deferred.resolve;
      req.onerror = deferred.reject;

      return deferred.promise;
    },

    update: (storeName, key, updates) => {
      let deferred = defer();

      cw.db.get(storeName, key, 'readwrite').then(([obj, store]) => {
        for (let key in updates) {
          obj[key] = updates[key];
        }

        let req = store.put(obj);
        req.onsuccess = () => deferred.resolve(obj);
        req.onerror = deferred.reject;
      }, deferred.reject);

      return deferred.promise;
    }
  },

  /* UI */
  ui: {
    getWidgetTooltip: () => str(prefs.isEnabled ? 'CW_tooltip_on' : 'CW_tooltip_off'),
    getWidgetContent: () => str(prefs.isEnabled ? 'CW_content_on' : 'CW_content_off'),

    init: () => {
      let widget = require('sdk/widget').Widget({
        id: 'cleanerWebWidget',
        label: str('CW_toggle'),
        tooltip: cw.ui.getWidgetTooltip(),
        content: cw.ui.getWidgetContent(),
        width: 40,
        onClick: () => prefs.isEnabled = !prefs.isEnabled
      });

      simplePrefs.on('isEnabled', name => {
        widget.content = cw.ui.getWidgetContent();
        widget.tooltip = cw.ui.getWidgetTooltip();
      });
    }
  },

  /* REMOTE */
  remote: {
    get: baseUrl => {
      let deferred = defer();

      Request({
        url: [baseUrl, 'package.json'].join('/'),
        onComplete: response => {
          let ret = response.json;
          if (ret) {
            ret.source = baseUrl;
          }
          deferred.resolve(ret);
        }
      }).get();

      return deferred.promise;
    },

    getAll: () => {
      let deferred = defer();

      cw.db.getAllKeys('remotes').then(urls => {
        if (urls.length === 0) {
          deferred.resolve([]);
        } else {
          all(urls.map(cw.remote.get)).then(deferred.resolve, console.log);
        }
      });

      return deferred.promise;
    },

    loadAll: configurations => {
      let deferred = defer();
      let mods = cw.mod.formatFromConfigurations(configurations);

      console.log('load mods: ', configurations);
      all(mods.map(cw.mod.register))
        .then(() => cw.mod.cleanAllButKeys(mods.map(mod => mod.uid)), console.log)
        .then(deferred.resolve, console.log);

      return deferred.promise;
    },

    updateAll: () => {
      return cw.remote.getAll().then(cw.remote.loadAll).then(null, console.log);
    }
  },

  /* MOD */
  mod: {
    refs: {},

    attachAll: () => {
      cw.db.each('mods', cursor => {
        // attach only if not allready attached and css was obtained
        if (!cw.mod.refs[cursor.key] && cursor.value.css && cursor.value.enabled) {
          cw.mod.attach(cursor.value);
        }
      }).then(() => {
        if (prefs.showContextMenu) {
          cw.contextMenu.attachAll();
        }
      });
    },

    detachAll: (toggling = true) => {
      cw.db.each('mods', cursor => {
        if (cw.mod.refs[cursor.key]) {
          cw.mod.detach(cursor.value, toggling);
        }
      }).then(() => {
        if (prefs.showContextMenu) {
          cw.contextMenu.detachAll();
        }
      });
    },

    attach: mod => {
      let deferred = defer();

      if (cw.mod.refs[mod.uid]) cw.mod.detach(mod);

      let options = {
        include: mod.pattern,
        attachTo: ['top', 'existing'],
        contentStyle: mod.css
      };

      cw.mod.refs[mod.uid] = pageMod.PageMod(options);
      cw.db.update('mods', mod.uid, { enabled: true }).then(deferred.resolve, deferred.reject);

      console.log('mod attached: ', mod.uid);

      return deferred.promise;
    },

    attachByUid: uid => cw.db.get('mods', uid).then(([obj]) => cw.mod.attach(obj)),

    detach: (mod, toggling = false) => cw.mod.detacByUid(mod.uid, toggling),

    detacByUid: (uid, toggling = false) => {
      let deferred = defer();

      if (cw.mod.refs[uid]) {
        cw.mod.refs[uid].destroy();
        delete cw.mod.refs[uid];
        if (!toggling) {
          cw.db.update('mods', uid, { enabled: false }).then(deferred.resolve, deferred.reject);
        }

        console.log('mod detached: ', uid);
      } else {
        deferred.reject(new Error());
      }

      return deferred.promise;
    },

    toggle: mod => mod.enabled ? cw.mod.detach(mod) : cw.mod.attach(mod),

    toggleByUid: uid => cw.db.get('mods', uid).then(([obj]) => cw.mod.toggle(obj)),

    getCss: mod => {
      let deferred = defer();

      Request({
        url: [mod.source, mod.domain, mod.id + '.css'].join('/'),
        onComplete: response => deferred.resolve(response.text)
      }).get();

      return deferred.promise;
    },

    formatFromConfigurations: configurations => {
      return configurations.reduce((a, b) => a.concat(cw.mod.formatFromConfiguration(b)), []);
    },

    formatFromConfiguration: conf => {
      let mods = [];
      let source = conf.source;

      for (let domain in conf.websites) {
        let website = conf.websites[domain];

        for (let id in website.mods) {
          mods.push({
            uid: [source, domain, id].join('::'),
            id: id,
            domain: domain,
            source: source,
            pattern: website.include,
            version: website.mods[id],
            enabled: true,
            css: null
          });
        }
      }

      return mods;
    },

    register: mod => {
      let deferred = defer();

      cw.db.get('mods', mod.uid).then(([result]) => {
        if (result) {
          if (result.version !== mod.version) {
            console.log('updating mod: ', mod.uid);
            cw.mod.getCss(mod).then(css => {
              mod.css = css;
              // preserve enabled status;
              mod.enabled = result.enabled;
              cw.db.put('mods', mod).then(deferred.resolve, deferred.resolve);
            });
          } else if (!result.css) {
            console.log('mod css missing: ', mod.uid);
            cw.mod.getCss(mod).then(css => {
              cw.db.update('mods', mod.uid, { css: css }).then(deferred.resolve, deferred.resolve);
            });
          } else {
            console.log('mod up-to-date: ', mod.uid);
            deferred.resolve();
          }
        } else {
          console.log('new mod: ', mod.uid)
          cw.mod.getCss(mod).then(css => {
            mod.css = css;
            cw.db.add('mods', mod).then(deferred.resolve, deferred.resolve);
          });
        }
      }, err => {
        console.log('failed loading mod: ', mod.uid, err);
        deferred.resolve();
      });

      return deferred.promise;
    },

    cleanAllButKeys: keys => {
      let deferred = defer();

      cw.db.each('mods', cursor => {
        if (!keys.contains(cursor.key)) {
          cursor.source.delete(cursor.key);
        }
      }, 'readwrite').then(deferred.resolve);

      return deferred.promise;
    }
  },

  /* CONTEXT MENU */
  contextMenu: {
    refs: {},

    label: mod => '(' + (mod.enabled ? 'x' : '-') + ') ' + str(mod.id),

    updateLabel: mod => {
      let menu = cw.contextMenu.refs[mod.domain];
      if (menu) {
        let items = menu.items;
        for (let item of items) {
          if (item.data === mod.uid) {
            item.label = cw.contextMenu.label(mod);
            break;
          }
        }
      }
    },

    updateLabelByUid: uid => {
      cw.db.get('mods', uid).then(([obj]) => cw.contextMenu.updateLabel(obj));
    },

    attachMod: mod => {
      let ctx = cm.URLContext(mod.pattern);
      let menu = cw.contextMenu.refs[mod.domain];

      if (!menu) {
        menu = cw.contextMenu.refs[mod.domain] = cm.Menu({
          context: ctx,
          label: str('CW'),
          contentScript: 'self.on("click", (node, data) => self.postMessage(data))',
          onMessage: uid => {
            cw.db.get('mods', uid).then(([mod]) => {
              cw.mod.toggle(mod).then(mod => {
                menu.items[menu.items.map(item => item.data).indexOf(uid)].label = cw.contextMenu.label(mod);
              }, console.log).then(null, console.log);

            })
          }
        });
      }

      if (!menu.items.some(item => item.data === mod.uid)) {
        menu.addItem(cm.Item({
          label: cw.contextMenu.label(mod),
          data: mod.uid
        }));
      }
    },

    detachModByUid: uid => {
      cw.db.get('mods', uid).then(([mod]) => cw.contextMenu.detachMod(mod)).then(null, console.log);
    },

    detachMod: mod => {
      let menu = cw.contextMenu.refs[mod.domain];
      if (menu) {
        let item = -1;
        for (let i = 0, ln = menu.items.length; i < ln; i++) {
          if (menu.items[i].data === mod.uid) {
            menu.removeItem(menu.items[i]);
            break;
          }
        }

        if (menu.items.length === 0) {
          menu.destroy();
          delete cw.contextMenu.refs[mod.domain];
        }
      }
    },

    attachAll: () => {
      cw.db.each('mods', cursor => cw.contextMenu.attachMod(cursor.value)).then(null, console.log);
    },

    detachAll: () => {
      cw.db.each('mods', cursor => cw.contextMenu.detachMod(cursor.value)).then(null, console.log);
    }
  },

  /* ADDON PAGE */
  page: {
    open: () => {
      tabs.open(data.url('addon-page/index.html'));
    },

    init: () => {
      pageMod.PageMod({
        include: data.url('addon-page/index.html'),
        contentScriptFile: data.url('addon-page/worker.js'),
        onAttach: worker => {
          console.log('addon-page worker attached');
        }
      });
    }
  }
}

console.log(self.name + ' (' + self.version + ') started.');

cw.init().then(() => {
  console.log('initialized');
});
