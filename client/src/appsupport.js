document.title = window.location.hostname.split('.')[0] + " - Dark";

class RopArrow extends HTMLElement {
  constructor() {
    super();
  }
  update() {
    var tlid = this.getAttribute("tlid");
    var target = document.querySelector(".tl-" + tlid + " .rop-rail");
    if(target) {
      const targetPos = target.getBoundingClientRect();
      const sourcePos = this.getBoundingClientRect();
      const arrowHeadLength = 12;
      const x2 = targetPos.right - sourcePos.left - arrowHeadLength;
      const x1 = x2 / 3;

      var arrowRight = document.querySelector("rop-arrow > svg > path");
      var svg = document.querySelector("rop-arrow > svg");
      svg.setAttribute("width", x2 + arrowHeadLength);

      var d = "M 0,20 C 0,8 " + x1 + ",8 " + x2 + ",15";
      arrowRight.setAttribute("d", d);
    }
  }
  connectedCallback() {
    this.update();
  }
  static get observedAttributes() {
    return ['update'];
  }
  attributeChangedCallback(attr, _, val) {
    this.update();
  }
}
window.customElements.define('rop-arrow', RopArrow);

const mousewheel = function(callback){
  require("domready")(function () {
    require("mouse-wheel")(document.body, callback);
  });
};

// Allows us capture certain keys and stop them from affecting the browser.
function stopKeys(event) {
  if (event.keyCode == 9) { // Tab
    event.preventDefault();
  }
  if (event.keyCode == 32 // Space
      && !event.target.parentNode.className.includes("string-container")) {
    event.preventDefault();
  }
  if (event.keyCode == 13 // Enter
      && !event.target.parentNode.className.includes("large-string")) {
    event.preventDefault();
  }
  if (event.keyCode == 38 // Up
      || event.keyCode == 40) {  // Down
    if (document.activeElement.tagName.toLowerCase() !== 'textarea')
      event.preventDefault();
  }
}
window.stopKeys = stopKeys;

// ---------------------------
// Rollbar
// ---------------------------
var rollbar = require('rollbar');

var Rollbar = rollbar.init({});
window.Rollbar = Rollbar;
window.Rollbar.configure(rollbarConfig);

// ---------------------------
// Entrybox Caret
// ---------------------------

// The autocomplete box has the id 'search-container', and a number of
// subnodes, notably 'entry-box' and 'fluidWidthSpan'. 'entry-box' is where we
// write code, and where the cursor is. fluidWidthSpan has the text content of 
// the box.
// However, for string entries, there is a textbox with the id 'entry-box'. This 
// does have the text content.

function entrybox() {
  return document.getElementById('entry-box');
}

function fluidWidthSpan() {
  return document.getElementById("fluidWidthSpan");
}

// utils
function getTextNode(node) {
  return Array.from(node.childNodes).find(n => (n.nodeName == '#text'));
}

function getXPosOf(node, offset) {
  if (node.nodeType == node.TEXT_NODE) {
    let range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset);
    return range.getClientRects()[0].left;
  } else {
    // There appears to be no good way to get the actual coordinates of the
    // cursor in a textarea, without making a clone, adding a span at the cursor,
    // then finding the position of the span.
    // So we simulate.
    // Note that the text area does not include quotes, so they do not need to
    // be accounted for.
    // There is a small offset bug somewhere, where the expected x position of
    // the cursor is ever so slightly less than the bounds of the target. This
    // seems to only happen with strings, so this seems the obvious place to
    // handle it.
    return node.getBoundingClientRect().left
            + (offset * 8)
            + 0.04; // offset bug
  }
}

// string entry box
function stringContent() {
  let el = entrybox();
  if (!el) return null;
  return el.value;
}

function stringContentNode() {
  return entrybox();
}

// other (non string) entry box
function nonStringContentNode() {
  let node = fluidWidthSpan();
  if (!node) return null;
  return getTextNode(node);
}

function nonStringContent() {
  let node = nonStringContentNode();
  if (!node) return null;
  return node.textContent;
}

// generic interface
function getContent () {
  return nonStringContent() || stringContent();
}

function getContentNode () {
  return nonStringContentNode() || stringContentNode();
}

function getSelectionNode() {
  return entrybox();
}

function getContentLength() {
  return getContent().length;
}

function getSelectionEnd() {
  return getSelectionNode().selectionEnd;
}

// Rendered means when we're not showing the input box. For strings, this includes quotes.
function getBoundsOfRendered(element) {
  let rect = element.getBoundingClientRect();
  if (element.classList.contains("tstr")) {
    return [rect.left+8, rect.right-8];
  } else {
    return [rect.left, rect.right];
  }
}


// Find location of the 'old' node (where the cursor is), in browser coordinates.
function findCaretXPos() {
  if (!getContentNode()) { return x; }
  let offset = getSelectionEnd();
  let contentNode = getContentNode();
  return getXPosOf(contentNode, offset);
}

// Get target offset for 'new' node. Takes browser x/y coords in pixels, returns 
// offset in characters.
function findLogicalOffset(targetBlankOrId, x) {
  let target = document.getElementById(targetBlankOrId);
  if (!target) { return false; }

  let [tleft, tright] = getBoundsOfRendered(target);
  if (tright <= x) {
    console.log("X is to the right of target, returning offset: -1");
    return -1;
  } else if (tleft >= x) {
    console.log("X is to the left of target, returning offset: 0");
    return 0;
  }

  function isClickInRects(rects) {
    return Array.from(rects).some(r => (r.left<=x && x<r.right));
  }

  let targetNode = getTextNode(target);
  if (!targetNode) {
    console.error("No textNode found, returning offset 0.");
    return 0;
  }

  // go through the characters and see if our x value is within any of them
  let range = document.createRange();
  let length = targetNode.textContent.length; // rendered, so must have a textcontent
  for (let i = 0; i < length; i++) {
    range.setStart(targetNode, i);
    range.setEnd(targetNode, i + 1);
    if (isClickInRects(range.getClientRects())) {
      return i;
    }
  }

  console.error("We failed to set a correct offset!");
  return 0;
}

/* either we have room to move the caret in the node, or we return false and
  * move to another node */
function moveCaretLeft() {
  let length = getContentLength()
  if (length === null) { return false; }
  let currOffset = entrybox().selectionEnd;

  if (currOffset <= 0) {
    return false;
  }

  // selectionStart here because selectionEnd results in moving two cells at
  // a time. :shrug:
  entrybox().selectionStart -= 1;
  return true;
}

function moveCaretRight() {
  let length = getContentLength();
  if (length === null) { return false; }
  let currOffset = entrybox().selectionEnd;
  if (currOffset >= length) {
    return false;
  }
  entrybox().selectionEnd += 1;
  return true;
}

const entryboxCaret = {
  moveCaretLeft: moveCaretLeft,
  moveCaretRight: moveCaretRight,
  findCaretXPos: findCaretXPos,
  findLogicalOffset: findLogicalOffset
}

// ---------------------------
// Analysis
// ---------------------------

window.Dark = {
  caret: entryboxCaret,
  analysis: {
    requestAnalysis : function (params) {
      if (!window.analysisWorker) {
        console.log("analysisworker not loaded yet");
        return;
      }

      const handler = params.handler;
      const bToString = (blankOr) => blankOr[2] || null;
      const spec = params.handler.spec;
      const route = `${bToString(spec.module)}, ${bToString(spec.name)}, ${bToString(spec.modifier)}`;
      const tlid = handler.tlid;
      const trace = params.trace.id;

      window.analysisWorker.postMessage(
        { proto: window.location.protocol,
          params: JSON.stringify (params)
        }
      );

      window.analysisWorker.onmessage = function (e) {
        var result = e.data.analysis;
        var error = e.data.error;

        if (!error) {
          var event = new CustomEvent('receiveAnalysis', {detail: result});
          document.dispatchEvent(event);
        } else {
          var errorName = null;
          var errorMsg = null;
          try { errorName = error[1][1].c; } catch (_) {}
          try { errorMsg = error[2][1].c; } catch (_) {}
          try { if (!errorMsg) { errorMsg = error[2].c; } } catch (_) {}
          const errorStr = `${errorName} - ${errorMsg}`;

          // send to rollbar
          Rollbar.error( errorStr
                       , error
                       , { route: route
                         , tlid: tlid
                         , trace: trace });

          // log to console
          console.log(`Error processing analysis in (${route}, ${tlid}, ${trace})`, errorStr, error);

          // send to client
          displayError(`Error while executing (${route}, ${tlid}, ${trace}): ${errorStr}`);
        }
      }
    }
  },
  ast: {
    positions: function (tlid) {
      var extractId = function (elem) {
        var className = elem.className;
        var matches = /.*id-(\S+).*/g.exec(className);
        var id = matches[1];

        if (typeof id === 'undefined')
          throw 'Dark.ast.atomPositions: Cannot match Blank(id) regex for '+className;

        return id;
      };

      var find = function (tl, nested) {
        var atoms = [];
        tl.querySelectorAll(nested ? '.blankOr.nested' : '.blankOr:not(.nested)')
        .forEach((v,i,l) => {
          var rect = v.getBoundingClientRect();
          atoms.push({
            id: extractId(v),
            left: "" + (rect.left | 0),
            right: "" + (rect.right | 0),
            top: "" + (rect.top | 0),
            bottom: "" + (rect.bottom | 0)
          });
        })
        return atoms;
      }

      var toplevels = document.getElementsByClassName('toplevel tl-'+tlid);

      if (toplevels.length == 0)
        throw 'Dark.ast.atomPositions: Cannot find toplevel: '+tlid;

      var tl = toplevels[0];

      return {
        atoms: find(tl, false),
        nested: find(tl, true)
      }
    }
  }
}

function displayError (msg){
  var event = new CustomEvent('displayError', {detail: msg});
  document.dispatchEvent(event);
}

function windowFocusChange (visible){
  var event = new CustomEvent('windowFocusChange', {detail: visible});
  document.dispatchEvent(event);
}

window.onerror = function (msg, url, line, col, error) {
  window.Rollbar.error(msg, error);
  displayError(msg);
};


var pageHidden = false;

function visibilityCheck(){
  var hidden = false;
  if (typeof document.hidden !== 'undefined') {
    hidden = document.hidden;
  } else if (typeof document.mozHidden !== 'undefined') {
    hidden = document.mozHidden;
  } else if (typeof document.msHidden !== 'undefined') {
    hidden = document.msHidden;
  } else if (typeof document.webkitHidden !== 'undefined') {
    hidden = document.webkitHidden;
  }

  if (pageHidden != hidden) {
    windowFocusChange(hidden);
    pageHidden = hidden;
  }
}

function addWheelListener(elem){
  var prefix = "";
  var _addEventListener;
  var support;

  // detect event model
  if ( window.addEventListener ) {
      _addEventListener = "addEventListener";
  } else {
      _addEventListener = "attachEvent";
      prefix = "on";
  }

  // detect available wheel event
  support = "onwheel" in document.createElement("div") ? "wheel" : // Modern browsers support "wheel"
            document.onmousewheel !== undefined ? "mousewheel" : // Webkit and IE support at least "mousewheel"
            "DOMMouseScroll"; // let's assume that remaining browsers are older Firefox

  var listener = function( elem, useCapture ) {
      _addWheelListener( elem, support, useCapture );

      // handle MozMousePixelScroll in older Firefox
      if( support == "DOMMouseScroll" ) {
          _addWheelListener( elem, "MozMousePixelScroll", useCapture );
      }
  };

  function _addWheelListener( elem, eventName, useCapture ) {
      elem[ _addEventListener ](prefix + eventName, function( originalEvent ) {
          !originalEvent && ( originalEvent = window.event );

          // create a normalized event object
          var event = {
              // keep a ref to the original event object
              originalEvent: originalEvent,
              target: originalEvent.target || originalEvent.srcElement,
              type: "wheel",
              deltaMode: originalEvent.type == "MozMousePixelScroll" ? 0 : 1,
              deltaX: 0,
              deltaY: 0,
              deltaZ: 0,
              preventDefault: function() {
                  originalEvent.preventDefault ?
                      originalEvent.preventDefault() :
                      originalEvent.returnValue = false;
              }
          };

          // calculate deltaY (and deltaX) according to the event
          if ( support == "mousewheel" ) {
              event.deltaY = - 1/40 * originalEvent.wheelDelta;
              // Webkit also support wheelDeltaX
              originalEvent.wheelDeltaX && ( event.deltaX = - 1/40 * originalEvent.wheelDeltaX );
          } else {
              event.deltaY = originalEvent.deltaY || originalEvent.detail;
          }

      }, useCapture || false );
  }

  return listener(elem);
}

setTimeout(function(){
  const canvasName = new URL(window.location).pathname.split("/")[2];
  const params = JSON.stringify(
    {
      editorState: window.localStorage.getItem('editorState-' + canvasName),
      complete: complete,
      userContentHost: userContentHost,
      environment: environmentName,
      csrfToken: csrfToken
    });
  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('debug')) {
    app = app.debugging(document.body, params);
  } else {
    app = app.normal(document.body, params);
  }

  window.onresize = function(evt){
    const size = {
      width : window.innerWidth,
      height: window.innerHeight
    }
    var event = new CustomEvent('windowResize',
      { detail : size })
    document.dispatchEvent(event)
  };

  let analysisjs = fetch("//" + staticUrl + "/analysis.js").then(r => r.text());
  let analysissupportjs = fetch("//" + staticUrl + "/analysissupport.js").then(r => r.text());
  var analysisWorkerUrl;
  (async function () {
    analysisWorkerUrl = window.URL.createObjectURL(
      new Blob(
        [ await analysisjs
        , "\n\n"
        , await analysissupportjs
        ]));
    window.analysisWorker = new Worker(analysisWorkerUrl);
  })();

  window.onfocus = function(evt){ windowFocusChange(true) };
  window.onblur = function(evt){ windowFocusChange(false) };
  setInterval(visibilityCheck, 2000);
  addWheelListener(document);

}, 1)
// ---------------------------
// Exports
// ---------------------------
module.exports = {
  mousewheel: mousewheel
};
