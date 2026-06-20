// editor-engine.js
// ── UNIFIED RIGID TEXT ENGINE (MARKDOWN ↔ HTML) ──

function _engineInl(txt) {
  if(!txt) return '';
  var ph=[];
  txt=txt.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g,function(_,n,u){
    ph.push('<a href="'+u.replace(/"/g,'&quot;')+'" target="_blank">'+n+'</a>');
    return '\x01L'+(ph.length-1)+'\x01';
  });
  txt=txt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  txt=txt.replace(/\*\*([^*\n]+?)\*\*/g,'<strong>$1</strong>');
  txt=txt.replace(/\*([^*\n]+?)\*/g,'<em>$1</em>');
  txt=txt.replace(/~~([^~\n]+?)~~/g,'<s>$1</s>');
  txt=txt.replace(/\x01L(\d+)\x01/g,function(_,i){return ph[parseInt(i)];});
  txt=txt.replace(/(^|[\s(])(https?:\/\/[^\s<>"')\]]+)/g,function(m,pre,url){
    return pre+'<a href="'+url+'" target="_blank">'+url+'</a>';
  });
  return txt;
}

function engineMdToHtml(md) {
  if(!md||!md.trim()) return '<p><br></p>';
  var lines=md.split('\n'),out='',inUl=false,inOl=false,inTl=false;
  function closeAll(){
    if(inTl){out+='</ul>';inTl=false;}
    else if(inUl){out+='</ul>';inUl=false;}
    else if(inOl){out+='</ol>';inOl=false;}
  }
  lines.forEach(function(line){
    var tm=line.match(/^- \[([ x])\] (.*)$/);
    var bm=!tm&&line.match(/^[*-] (.+)$/);
    var om=!tm&&!bm&&line.match(/^\d+\. (.+)$/);
    if(tm){
      if(!inTl){closeAll();out+='<ul class="task-list">';inTl=true;}
      var ck=tm[1]==='x';
      out+='<li class="task-item'+(ck?' checked':'')+'" data-checked="'+ck+'">'
          +'<span class="task-cb" contenteditable="false" style="cursor:pointer;margin-right:6px;user-select:none;font-size:14px;color:'+(ck?'#16a34a':'var(--gray-400)')+'">'+(ck?'\u2611':'\u2610')+'</span>'
          +'<span>'+_engineInl(tm[2])+'</span></li>';
    } else if(bm){
      if(!inUl){closeAll();out+='<ul>';inUl=true;}
      out+='<li>'+_engineInl(bm[1])+'</li>';
    } else if(om){
      if(!inOl){closeAll();out+='</ol>';inOl=true;}
      out+='<li>'+_engineInl(om[1])+'</li>';
    } else {
      closeAll();
      out+=line.trim()?'<p>'+_engineInl(line)+'</p>':'<p><br></p>';
    }
  });
  closeAll();
  return out||'<p><br></p>';
}

function _engineNodeToMd(node){
  var out='';
  node.childNodes.forEach(function(c){
    if(c.nodeType===3){out+=c.textContent;return;}
    if(c.nodeType!==1) return;
    var tag=c.tagName.toLowerCase(),inner=_engineNodeToMd(c);
    if(tag==='strong'||tag==='b'){if(inner.trim()) out+='**'+inner+'**';}
    else if(tag==='em'||tag==='i'){if(inner.trim()) out+='*'+inner+'*';}
    else if(tag==='s'||tag==='del'){if(inner.trim()) out+='~~'+inner+'~~';}
    else if(tag==='a'){
      var href=c.getAttribute('href')||'',lt=c.textContent;
      out+=(href&&href!==lt)?'['+lt+']('+href+')' : (href||lt);
    }
    else if(tag==='br') out+='\n';
    else if(tag==='p') out+=(inner.trim()||'')+'\n';
    else if(tag==='div'&&!c.classList.contains('task-cb')) out+=(inner.trim()||'')+'\n';
    else if(tag==='span'&&c.classList.contains('task-cb')){/* skip */}
    else if(tag==='ul'){
      var isTL=c.classList.contains('task-list');
      c.querySelectorAll(':scope > li').forEach(function(li){
        var txt='';
        li.childNodes.forEach(function(n){
          if(n.nodeType===3) txt+=n.textContent;
          else if(n.nodeType===1&&!n.classList.contains('task-cb')) txt+=_engineNodeToMd(n);
        });
        txt=txt.trim();
        if(isTL||li.classList.contains('task-item')){
          var ck=li.classList.contains('checked')||li.dataset.checked==='true';
          out+='- ['+(ck?'x':' ')+'] '+txt+'\n';
        } else { out+='- '+txt+'\n'; }
      });
    }
    else if(tag==='ol'){
      var n=1; c.querySelectorAll(':scope > li').forEach(function(li){out+=n+'. '+_engineNodeToMd(li).trim()+'\n';n++;});
    }
    else out+=inner;
  });
  return out;
}

function engineHtmlToMd(html){
  var tmp=document.createElement('div'); tmp.innerHTML=html;
  return _engineNodeToMd(tmp).replace(/\n{3,}/g,'\n\n').trim();
}

function _engineClosest(node,tagName,root){
  var el=node&&node.nodeType===3?node.parentElement:node, d=0;
  while(el&&el!==root&&d<20){if(el.tagName===tagName) return el; el=el.parentElement; d++;}
  return null;
}

function _engineLiEmpty(li){
  var t=''; li.childNodes.forEach(function(n){
    if(n.nodeType===3) t+=n.textContent;
    else if(n.nodeType===1&&!n.classList.contains('task-cb')) t+=n.textContent;
  }); return !t.trim();
}

function engineClickHandler(e, canvasElement, saveCallback) {
  var cb = e.target.closest('.task-cb');
  if (cb) {
    e.preventDefault(); e.stopPropagation();
    var li = cb.parentElement; if(!li) return;
    var ck = li.classList.toggle('checked');
    li.dataset.checked = String(ck);
    cb.textContent = ck ? '\u2611' : '\u2610';
    cb.style.color = ck ? '#16a34a' : 'var(--gray-400)';
    if (typeof saveCallback === 'function') saveCallback();
    return;
  }
}

// ── MODERN STATEFUL TEXT SELECTION ENGINE ──
const ModernEngine = {
  insertHTML(html) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    
    const el = document.createElement('div');
    el.innerHTML = html;
    const frag = document.createDocumentFragment();
    let node, lastNode;
    while ((node = el.firstChild)) { lastNode = frag.appendChild(node); }
    range.insertNode(frag);
    
    if (lastNode) {
      const newRange = range.cloneRange();
      newRange.setStartAfter(lastNode);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
  },

  insertText(text) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  },

toggleInline(cmd) {
    const tagMap = { 'bold': 'strong', 'italic': 'em', 'strikethrough': 's' };
    const tagName = tagMap[cmd.toLowerCase()];
    if (!tagName) return;

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    
    // Locate the container element of the current selection highlight
    let parentNode = range.commonAncestorContainer;
    if (parentNode.nodeType === 3) { // 3 means it is a raw TEXT_NODE
      parentNode = parentNode.parentNode;
    }
    
    // Check if the highlighted text is already nested inside the targeted formatting style
    const existingTag = parentNode.closest(tagName);
    
    if (existingTag) {
      // UN-TOGGLE STYLE: Extract text contents out of the tag to revert to normal text
      const fragment = document.createDocumentFragment();
      while (existingTag.firstChild) {
        fragment.appendChild(existingTag.firstChild);
      }
      existingTag.parentNode.replaceChild(fragment, existingTag);
    } else {
      // APPLY STYLE: Wrap the exact selected text fragments into the modern semantic element safely
      const wrapperElement = document.createElement(tagName);
      try {
        // extractContents safely pulls nodes out of the DOM tree without breaking deep block roots
        wrapperElement.appendChild(range.extractContents());
        range.insertNode(wrapperElement);
        
        // Re-apply focus selection highlights cleanly across the text block for smooth UX
        const reselectRange = document.createRange();
        reselectRange.selectNodeContents(wrapperElement);
        sel.removeAllRanges();
        sel.addRange(reselectRange);
      } catch (error) {
        console.warn('[Text Engine] Cross-node fragment boundary wrap bypassed safely:', error);
      }
    }
  },

  indent(li) {
    if (!li) return;
    let prev = li.previousElementSibling;
    if (prev && prev.tagName === 'LI') {
      let nestedList = prev.querySelector('ul, ol');
      if (!nestedList) {
        const nextTag = li.parentNode.tagName === 'OL' ? 'UL' : li.parentNode.tagName;
        nestedList = document.createElement(nextTag);
        if (nextTag === 'UL' && li.parentNode.classList.contains('task-list')) {
          nestedList.className = 'task-list';
        }
        prev.appendChild(nestedList);
      }
      nestedList.appendChild(li);
      
      if (nestedList.tagName === 'UL' && !nestedList.classList.contains('task-list')) {
        li.className = '';
        li.removeAttribute('data-checked');
        const cb = li.querySelector('.task-cb');
        if (cb) cb.remove();
      }
      this.moveCaretToEnd(li);
    }
  },

  outdent(li) {
    if (!li) return;
    let parentList = li.parentNode;
    let grandParentLi = parentList.parentNode;
    if (grandParentLi && grandParentLi.tagName === 'LI') {
      grandParentLi.after(li);
      if (parentList.children.length === 0) parentList.remove();
      this.moveCaretToEnd(li);
    } else {
      let p = document.createElement('p');
      p.innerHTML = li.innerHTML.replace(/<span class="task-cb".*?<\/span>/i, '');
      if (!p.innerHTML.trim() || p.innerHTML === '&#x200b;') p.innerHTML = '<br>';
      parentList.parentNode.insertBefore(p, parentList.nextSibling);
      li.remove();
      if (parentList.children.length === 0) parentList.remove();
      
      const sel = window.getSelection();
      const r = document.createRange(); r.setStart(p, 0); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    }
  },

  toggleListBlock(type) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    
    let block = range.startContainer;
    if (block.nodeType === 3) block = block.parentNode;
    block = block.closest('p, div, li');
if (!block || block.id === 'notes-canvas' || block.id === 'editor') {
      block = document.createElement('p');
      block.innerHTML = '<br>';
      range.insertNode(block);
    }

    if (block.tagName === 'LI') {
      const parentList = block.parentNode;
      const isCurrentType = (type === 'ul' && parentList.tagName === 'UL' && !parentList.classList.contains('task-list')) ||
                            (type === 'ol' && parentList.tagName === 'OL') ||
                            (type === 'task' && parentList.classList.contains('task-list'));
      
      if (isCurrentType) {
        const p = document.createElement('p');
        p.innerHTML = block.innerHTML.replace(/<span class="task-cb".*?<\/span>/i, '');
        if (!p.innerHTML.trim() || p.innerHTML === '&#x200b;') p.innerHTML = '<br>';
        parentList.parentNode.insertBefore(p, parentList.nextSibling);
        block.remove();
        if (!parentList.children.length) parentList.remove();
        
        range.setStart(p, 0); range.collapse(true);
        sel.removeAllRanges(); sel.addRange(range);
      } else {
        if (type === 'task') {
          parentList.className = 'task-list';
          if (parentList.tagName === 'OL') {
            const newList = document.createElement('ul'); newList.className = 'task-list';
            parentList.replaceWith(newList); newList.appendChild(block);
          }
          if (!block.querySelector('.task-cb')) {
            block.className = 'task-item'; block.dataset.checked = 'false';
            block.innerHTML = '<span class="task-cb" contenteditable="false" style="cursor:pointer;margin-right:6px;user-select:none;font-size:14px;color:var(--gray-400)">☐</span>' + block.innerHTML;
          }
        } else {
          block.className = ''; block.removeAttribute('data-checked');
          const cb = block.querySelector('.task-cb'); if (cb) cb.remove();
          const newList = document.createElement(type);
          if (parentList.classList.contains('task-list')) parentList.className = '';
          parentList.replaceWith(newList); newList.appendChild(block);
        }
        this.moveCaretToEnd(block);
      }
    } else {
      const list = document.createElement(type === 'task' ? 'ul' : type);
      if (type === 'task') list.className = 'task-list';
      const li = document.createElement('li');
      li.innerHTML = block.innerHTML === '<br>' ? '' : block.innerHTML;
      
      if (type === 'task') {
        li.className = 'task-item'; li.dataset.checked = 'false';
        li.innerHTML = '<span class="task-cb" contenteditable="false" style="cursor:pointer;margin-right:6px;user-select:none;font-size:14px;color:var(--gray-400)">☐</span>' + (li.innerHTML || '&#x200b;');
      }
      if (!li.innerHTML) li.innerHTML = '<br>';
      list.appendChild(li);
      block.replaceWith(list);
      this.moveCaretToEnd(li);
    }
  },

  moveCaretToEnd(el) {
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
};

function engineKeydownHandler(e, canvasElement, saveCallback) {
  var sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  // 1. Tab Handler
  if (e.key === 'Tab') {
    e.preventDefault();
    var li = _engineClosest(sel.anchorNode, 'LI', canvasElement);
    if (li) {
      e.shiftKey ? ModernEngine.outdent(li) : ModernEngine.indent(li);
      if (typeof saveCallback === 'function') saveCallback();
    } else {
      ModernEngine.insertText('  ');
    }
    return;
  }

  // 2. Enter Handler
  if (e.key === 'Enter' && !e.shiftKey) {
    var li = _engineClosest(sel.anchorNode, 'LI', canvasElement);
    if (li) {
      e.preventDefault();
      if (_engineLiEmpty(li)) {
        var parentList = li.parentNode;
        var p = document.createElement('p'); p.innerHTML = '<br>';
        parentList.parentNode.insertBefore(p, parentList.nextSibling);
        li.remove();
        if (!parentList.querySelectorAll('li').length) parentList.remove();
        var r = document.createRange(); r.setStart(p, 0); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
      } else {
        var newLi = document.createElement('li');
        newLi.className = li.className;
        if (li.parentNode.classList.contains('task-list')) {
          newLi.className = 'task-item'; newLi.dataset.checked = 'false';
          newLi.innerHTML = '<span class="task-cb" contenteditable="false" style="cursor:pointer;margin-right:6px;user-select:none;font-size:14px;color:var(--gray-400)">☐</span>&#x200b;';
        } else {
          newLi.innerHTML = '<br>';
        }
        li.after(newLi);
        var r = document.createRange(); r.setStart(newLi.lastChild || newLi, 0); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
      }
      if (typeof saveCallback === 'function') saveCallback();
      return;
    }
  }

  // 3. Stateful Backspace Handler (Google Docs flow)
  if (e.key === 'Backspace') {
    var li = _engineClosest(sel.anchorNode, 'LI', canvasElement);
    if (li) {
      const rangeBefore = document.createRange();
      rangeBefore.setStart(li, 0);
      rangeBefore.setEnd(sel.anchorNode, sel.anchorOffset);
      const fragBefore = rangeBefore.cloneContents();
      const cb = fragBefore.querySelector('.task-cb');
      if (cb) cb.remove();

      const isAtStart = fragBefore.textContent.replace(/\u200b/g, '').trim().length === 0;

      if (isAtStart) {
        e.preventDefault();
        let parentList = li.parentNode;
        let grandParentLi = parentList.parentNode;

        if (grandParentLi && grandParentLi.tagName === 'LI') {
          // Scenario A: Inner nesting conversion
          ModernEngine.outdent(li);
        } else {
          // Scenario B: Root-level list breakout
          let p = document.createElement('p');
          p.innerHTML = li.innerHTML.replace(/<span class="task-cb".*?<\/span>/i, '');
          if (!p.innerHTML.trim() || p.innerHTML === '&#x200b;') p.innerHTML = '<br>';

          let nextSiblings = [];
          let sib = li.nextElementSibling;
          while (sib) { nextSiblings.push(sib); sib = sib.nextElementSibling; }

          parentList.after(p);

          if (nextSiblings.length > 0) {
            let newList = document.createElement(parentList.tagName);
            newList.className = parentList.className;
            p.after(newList);
            nextSiblings.forEach(s => newList.appendChild(s));
          }

          li.remove();
          if (parentList.children.length === 0) parentList.remove();

          const r = document.createRange();
          r.setStart(p, 0);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }

        if (typeof saveCallback === 'function') saveCallback();
        return;
      }
    }
  }
}

// ── INTEGRATED TASK INJECTOR ──
// Safely toggles modern semantic checklist items inside contenteditable containers
function engineInsertTask(el, saveCallback) {
  ModernEngine.toggleListBlock('task');
  if (typeof saveCallback === 'function') saveCallback();
}

// ── INTEGRATED LINK INJECTOR ──
// Prompts the user for a URL and securely injects a formatted anchor tag into the active text selection
function engineInsertLink(el, saveCallback) {
  var url = prompt('Enter link URL (e.g. https://google.com):');
  if (!url) return;
  if (!url.match(/^https?:\/\//i)) url = 'https://' + url;
  
  var sel = window.getSelection();
  var text = sel ? sel.toString().trim() : '';
  var display = text || url;
  var htmlLink = '<a href="' + url.replace(/"/g, '&quot;') + '" target="_blank">' + _engineInl(display) + '</a> ';
  
  ModernEngine.insertHTML(htmlLink);
  if (typeof saveCallback === 'function') saveCallback();
}

// ── INTEGRATED PASTE HANDLER ──
// Strips complex nested application styling on paste to keep plaintext raw content values only
function enginePasteHandler(e, canvasElement, saveCallback) {
  e.preventDefault();
  var text = (e.clipboardData || window.clipboardData).getData('text/plain');
  ModernEngine.insertText(text);
  if (typeof saveCallback === 'function') saveCallback();
}