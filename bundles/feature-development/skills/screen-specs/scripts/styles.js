(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScreenStyles = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  var base = { '--m-surface':'#ffffff','--m-on-surface':'#1a1c1e','--m-primary':'#3b5bdb',
    '--m-outline-variant':'#d7dbe0','--m-surface-container-low':'#f5f7fa',
    '--m-primary-container':'#dde3fb','--m-on-primary-container':'#0b1b57','--surface-alpha':'1' };
  function merge(a,b){ var o={}; for(var k in a)o[k]=a[k]; for(var k in b)o[k]=b[k]; return o; }
  var STYLES = {
    'material':        merge(base,{ '--shadow-1':'0 1px 3px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.08)',
                                    '--shadow-2':'0 4px 12px rgba(0,0,0,.14)','--border-w':'0px',
                                    '--radius-scale':'1','--btn-fill':'solid','--motion':'full' }),
    'neo-flat':        merge(base,{ '--shadow-1':'none','--shadow-2':'none','--border-w':'1px',
                                    '--radius-scale':'.35','--btn-fill':'solid','--motion':'reduced',
                                    '--m-outline-variant':'#e2e5e9' }),
    'minimal-neutral': merge(base,{ '--shadow-1':'0 1px 2px rgba(16,24,40,.05)','--shadow-2':'0 4px 8px rgba(16,24,40,.06)',
                                    '--border-w':'1px','--radius-scale':'.6','--btn-fill':'solid','--motion':'full',
                                    '--m-primary':'#111827','--m-surface-container-low':'#f9fafb','--m-outline-variant':'#e5e7eb' }),
    'fluent':          merge(base,{ '--shadow-1':'0 2px 6px rgba(0,0,0,.10)','--shadow-2':'0 8px 20px rgba(0,0,0,.12)',
                                    '--border-w':'1px','--radius-scale':'.75','--btn-fill':'solid','--motion':'full',
                                    '--surface-alpha':'.86' })
  };
  function styleVars(name){
    var s = STYLES[name] || STYLES.material;
    return Object.keys(s).map(function(k){ return '  '+k+':'+s[k]+';'; }).join('\n');
  }
  return { STYLES: STYLES, styleVars: styleVars, STYLE_KEYS: Object.keys(STYLES) };
}));
