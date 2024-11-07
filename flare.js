const script_id = Math.random();

// util

/**
 * Uses HTMLTemplateElement.content to return a DocumentFragment given an HTML string
 * @param html_str HTML string
 * @return DocumentFragment representing the HTML string
 */
function fragment_from_string(html_str) {
  const template = document.createElement('template');
  template.innerHTML = html_str;
  return template.content;
}

/**
 * Constructs an adoptable stylesheet from a non-constructed one (e.g. from link el)
 * @param stylesheet a non-constructed stylesheet
 * @return a constructed stylesheet with the same rules
 */
export function get_constructed_style_sheet(stylesheet) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(get_css_text(stylesheet));
  return sheet;
}

/**
 * Returns CSS string given a CSSStyleSheet object
 * @param stylesheet CSSStyleSheet object
 * @return CSS string
 */
function get_css_text(stylesheet) {
  const rules = [];

  for (let i = 0; i < stylesheet.cssRules.length; i++) {
    rules.push(stylesheet.cssRules[i].cssText);
  }

  return rules.join('');
}

/**
 * Returns child dependencies of a DOM node
 * @param node DOM element
 * @return array of dependencies
 */
function find_nested_deps(node) {
  const ref_els = [...node.querySelectorAll('[ref]')]
  const deps = ref_els.map(el => el.getAttribute('ref').split(' ')).flat();
  return [...new Set(deps)];
}

async function hash_item(item) {
  // console.log("hash_item", item);
  delete item.hash;
  // Encode item json string as a Uint8Array
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(item));

  // Generate the hash using SHA-256
  const hash_buffer = await crypto.subtle.digest('SHA-256', data);

  // Convert the hash to a hex string
  const hash_array = Array.from(new Uint8Array(hash_buffer));
  const hash_hex = hash_array.map(b => b.toString(16).padStart(2, '0')).join('');

  return hash_hex;
}

function has_list(obj) {
  for (const key in obj) {
    if (Array.isArray(obj[key])) {
      return key; // return prop name
    }
  }
  return false;
}

function traverse_dom(node, node_r) {
  // Perform some operation on the current node
  if (node.nodeType === Node.ELEMENT_NODE) {
    // console.log("replace_with traverse_dom", node.dataset.hash); // Accessing dataset
    // console.log("replace_with traverse_dom:r", node_r);
    const match = node_r.querySelector(`[data-hash="${node.dataset.hash}"]`);
    // console.log("replace_with traverse_dom:m", match);
    if (node.dataset.hash && !match) {
      // console.log("matching", node_r.querySelector("[data-hash]")?.parentNode.isConnected);
      // console.log("matching", node_r.querySelector("[data-hash]")?.parentNode, node);
      node_r.querySelector("[data-hash]")?.parentNode.appendChild(node);
    }
    // console.log("replace_with traverse_dom:ra", node_r, document.querySelector("wd-feed"))
  }
  // Check if the node has child nodes
  if (node.hasChildNodes()) {
    // Get the child nodes
    const children = node.childNodes;

    // Recursively traverse each child node
    children.forEach(child => {
      traverse_dom(child, node_r);
    });
  }
}

function replace_with(el, new_el) {
  const has_hashes = el.querySelector("[data-hash]") !== null;
  // console.log("el.replaceWith has_hashes", has_hashes, el.querySelector("[data-hash]"));
  if (has_hashes) {
    traverse_dom(new_el, el);
    return false;
  } else {
    // console.log("el.replaceWith", el.id, new_el);
    el.replaceWith(new_el);
    return true;
  };
}

/**
 * Adds rendering logic to a functional web component
 * @param spec component data
 * @return frozen Object with component render functions
 */
export function web_component(spec) {
  const get_spec = () => spec;

  const render = (prop) => {
    // re_render instead if a DOMFragment exists
    if (spec.clone) {
      re_render(prop);
      return;
    }
    [spec.clone, spec.map] = spec._template(spec);
    // console.log('render', prop, spec.clone, spec.map);
    // attach the DOMFragment to the component's ShadowRoot
    spec._root.shadowRoot.appendChild(spec.clone);
  }

  const re_render = (prop) => {
    const [new_clone, new_map] = spec._template(spec);
    // console.log('re_render', prop, spec.clone, new_clone, spec.map, new_map);

    // use dependency map to make updates to shadow DOM
    spec.map.get(prop).forEach((el, i) => {
      const deps = el.getAttribute('ref').split(' ');
      // replace el with updated one from new DOMFragment
      // console.log("lisssss", el, spec._template(spec), new_map.get(prop)[i], spec[prop]);
      if (replace_with(el, new_map.get(prop)[i])) {
        // update dependency map
        deps.forEach(dep => {
          // find nested dependencies
          const nested_deps = find_nested_deps(spec.map.get(dep)[i]);
          // console.log('nested', dep, i, nested_deps);
          spec.map.get(dep)[i] = new_map.get(dep)[i];
          nested_deps.forEach(nested_dep => {
            spec.map.get(nested_dep)[i] = new_map.get(nested_dep)[i];
          })
        })
      }
    });
  }

  const adopt_styles = (sheets) => {
    spec._root.shadowRoot.adoptedStyleSheets = [...spec._root.shadowRoot.adoptedStyleSheets, ...sheets];
  }

  return Object.freeze({
    get_spec,
    render,
    adopt_styles
  })
}

/**
 * Template tag that returns the interpolated string as a DOMFragment
 * and a dependency -> array of elements Map.
 *
 * Dependencies have to be explicitly defined in the template by adding a
 * 'ref' attribute to the element, and an element can have multiple
 * dependencies (e.g., ref="a" or ref="a b").
 *
 * Dependencies can be nested, as long as they are different.
 *
 * @param strings array of string values in the template
 * @param values template expressions
 * @return array containing a DOMFragment and dependency map
 */
export function html(strings, ...values) {
  const html_str = strings.reduce((result, string, i) => {
    return `${result}${string}${values[i] || ''}`;
  }, '');
  // console.log(html_str);
  const dom_fragment = fragment_from_string(html_str);

  const map = new Map();
  const els = dom_fragment.querySelectorAll("[ref]");

  els.forEach(el => {
    const deps = el.getAttribute('ref').split(' ');

    deps.forEach(dep => {
      map.set(dep, map.has(dep) ? [...map.get(dep), ...[el]] : [el]);
    })
  });
  // console.log('html', dom_fragment, map);
  return [dom_fragment, map];
}

export function state(spec) {
  return new Proxy(spec, {
    get: function(obj, prop) {
      //// console.log(obj, prop, obj[prop]);
      return obj[prop];
    },
    set: async function(obj, prop, value) {
      // console.log("set", obj, prop, value);
      const list_prop = has_list(value);
      // console.log("list_prop", list_prop, obj[prop], value);
      if (list_prop) {
        for (let i = 0; i < value[list_prop].length; i++) {
          value[list_prop][i].hash = await hash_item(value[list_prop][i]);
        }
        // console.log("set_hash", list_prop, value);
      }
      obj[prop] = value;
      //// console.log("spec", spec);
      spec._root.component.render(prop);
      //// console.log(spec._root.component);
      if (spec._root.component.effects) {
        if (spec._root.component.cleanup_effects) {
          // console.log(spec._root.component.cleanup_effects);
          spec._root.component.cleanup_effects();
        }
        spec._root.component.effects();
      }
      return true;
    }
  });
}

let shared_style_sheets = [];

/**
 * Sets constructed shared_styles_sheets given non-constructed sheets. These
 * are the stylesheets that are going to be adopted by all components defined
 * by this instance.
 *
 * @param sheets non-constructed document stylesheets
 * @return void
 */
export function set_shared_style_sheets(sheets) {
  const constructed_sheets = sheets.map(sheet => get_constructed_style_sheet(sheet));
  // console.log(`${script_id}:set_shared_style_sheets`, constructed_sheets, shared_style_sheets);
  shared_style_sheets = [...constructed_sheets];
}

export function define_component(opts) {
  customElements.define(
    opts.name,
    class CustomElement extends HTMLElement {
      static get observedAttributes() {
        return opts.props;
      }

      constructor() {
        super();
        // console.log("constructor", this);
        const shadow = this.attachShadow({ mode: 'open' });
        this.component = opts.component({ _root: this, shadow, _template: opts.template });
      }

      style(style) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(style);
        // console.log(`${script_id}:${opts.name}:define_component:style`, shared_style_sheets);
        this.shadowRoot.adoptedStyleSheets = [...shared_style_sheets, sheet];
      }

      connectedCallback() {
        //// console.log("connected");
        //// console.log('render');
        this.component.render();
        //// console.log('effects');
        if (this.component.effects) {
          this.component.effects();
          //// console.log(this.cleanup_effects);
        }
        if (this.component.init) {
          //// console.log('init', this.component, this.component.init);
          this.component.init();
        }
        this.style(opts.style);
      }

      attributeChangedCallback(name, oldValue, newValue) {
        //// console.log(name, oldValue, newValue);
        this.component.get_spec()[name] = newValue;
      }
    }
  )
}


