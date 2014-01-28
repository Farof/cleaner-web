(exports => {
  "use strict";

  var conf = {
    "websites": {
      "lemonde.fr": {
        "include": "*.lemonde.fr",
        "mods": {
          "ads": "1.0.0",
          "comment": "1.0.0",
          "nav": "1.0.0",
          "social": "1.0.0",
          "subscribe": "1.0.0",
          "toolbar": "1.0.0"
        }
      }
    }
  };

  function tn(str) {
    return document.createTextNode(str);
  }

  exports.cw = {
    table: null,

    cleanTable: () => {

    },

    loadWebsites: websites => {
      console.log('load websites');
      var t = cw.table, h = t.tHead.rows[1], domain, mods, mod, r, c, i, ln, chk;
      for (domain in websites) {
        mods = [].map.call(h.cells, cell => cell.textContent).slice(1);
        for (mod in websites[domain].mods) {
          i = mods.indexOf(mod);
          if (i < 0) {
            h.insertCell().appendChild(tn(mod));
            mods.push(mod);
          }
        }

        r = t.tBodies[0].insertRow();
        r.insertCell().appendChild(tn(domain));
        for (i = 0, ln = mods.length; i < ln; i++) {
          c = r.insertCell();
          if (websites[domain].mods[mods[i]]) {
            chk = document.createElement('input');
            chk.setAttribute('type', 'checkbox');
            chk.checked = true;
            chk.domain = domain;
            chk.mod = mods[i];
            c.appendChild(chk);
          }
        }
      }
    }
  };

  document.addEventListener('DOMContentLoaded', ev => {
    cw.table = document.getElementById('websites-table');
    cw.table.addEventListener('click', ev => {
      var chk = ev.target;
      if (chk.nodeName.toLowerCase() === 'input') {
        console.log('toggle ' + chk.domain + ':' + chk.mod + ' - ' + chk.checked);
      }
    });
    cw.cleanTable();

    // cw.loadWebsites(conf.websites);
  });

})(this);
