var { Observable } = require("./rx");

function RequestError(url, xhr, message, reason = null) {
  this.name = "RequestError";
  this.url = url;
  this.xhr = xhr;
  this.code = xhr.status;
  this.reason = reason;
  this.message = `request: ${message} (${url})`;
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, RequestError);
  }
}
RequestError.prototype = new Error();

function RestCallMethodError(url, { code, method, message }) {
  this.name = "RestCallMethodError";
  this.url = url;
  this.code = code;
  this.message = `restmethodcall: webservice error status ${code} (${url})${method ? " (" + method + ")" : ""}${message ? "\n" + message : ""}`;
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, RestCallMethodError);
  }
}
RestCallMethodError.prototype = new Error();

function RestCallResult(response, url, scriptInfo) {
  var restCallResult = response.querySelector("RestCallResult");
  var status = +restCallResult.querySelector("Status").textContent;
  if (status < 0)
    throw new RestCallMethodError(url, { code: status, method: scriptInfo });
  else
    return {
      output: restCallResult.querySelector("Output"),
      status: status,
    };
}

function toJSONForIE(blob) {
  try {
    return JSON.parse(blob);
  } catch(e) {
    return null;
  }
}

function getResponseHeadersList(xhr, headersList) {
  var headers = {}, header;
  for (var i = 0; i < headersList.length; i++) {
    header = headersList[i];
    headers[header] = xhr.getResponseHeader(header);
  }
  return headers;
}

/**
 * Creates an observable HTTP request.
 * The options that can be passed are:
 *
 *    - url        Request's url
 *    - [method]   HTTP method (defaults is "GET")
 *    - [data]     Sent data for "POST", "UPDATE" or "PATCH" requests
 *    - [headers]  Object containing headers key/value
 *    - [format]   Format of the response, according to the XMLHttpRequest Level 2
 *                 response type: "arraybuffer", "blob", "document", "json" or "text" (defaults)
 */
function request(options) {
  if (options.format == "rest-call-method") {
    return restCallMethod(options);
  }

  return Observable.create(observer => {
    var {
      url,
      method,
      data,
      headers,
      format,
      withMetadata,
      responseHeaders,
    } = options;

    var xhr = new XMLHttpRequest();
    xhr.open(method || "GET", url, true);

    // Special case for document format: some manifests may have a
    // null response because of wrongly namespaced XML file. Also the
    // document format rely on specific Content-Type headers which may
    // erroneous. Therefore we use a text responseType and parse the
    // document with DOMParser.
    if (format == "document") {
      xhr.responseType = "text";
    } else {
      xhr.responseType = format || "text";
    }

    if (headers) {
      for (var name in headers) xhr.setRequestHeader(name, headers[name]);
    }

    xhr.addEventListener("load",  onLoad,  false);
    xhr.addEventListener("error", onError, false);

    var sent = Date.now();

    xhr.send(data);

    function onLoad(evt) {
      var x = evt.target;
      var s = x.status;
      if (s < 200 || s >= 300) {
        return observer.onError(new RequestError(url, x, x.statusText));
      }

      var duration = Date.now() - sent;
      var blob;
      if (format == "document") {
        blob = new global.DOMParser().parseFromString(x.responseText, "text/xml");
      } else {
        blob = x.response;
      }

      if (format == "json" && typeof blob == "string") {
        blob = toJSONForIE(blob);
      }

      if (blob == null) {
        return observer.onError(new RequestError(url, x,
          `null response with format "${format}" (error while parsing or wrong content-type)`));
      }

      // TODO(pierre): find a better API than this "withMetadata" flag
      // (it is weird and collisions with responseHeaders)
      if (withMetadata) {
        var headers;
        if (responseHeaders) {
          headers = getResponseHeadersList(x, responseHeaders);
        }

        var size = evt.total;

        observer.onNext({
          blob,
          size,
          duration,
          headers,
          url: x.responseURL || url,
          xhr: x,
        });
      }
      else {
        observer.onNext(blob);
      }

      observer.onCompleted();
    }

    function onError(e) {
      observer.onError(new RequestError(url, e, "error event"));
    }

    return () => {
      var { readyState } = xhr;
      if (0 < readyState && readyState < 4) {
        xhr.removeEventListener("load",  onLoad);
        xhr.removeEventListener("error", onError);
        xhr.abort();
      }
      xhr = null;
    };
  });
}

var ENTITIES_REG = /[&<>]/g;
var ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;"
};

function escapeXml(xml) {
  return (xml || "")
    .toString()
    .replace(ENTITIES_REG, tag => ENTITIES[tag]);
}

function objToXML(obj) {
  var xml = "";
  for (var attrName in obj) {
    var attr = obj[attrName];
    var inner = (typeof attr == "object")
      ? objToXML(attr)
      : escapeXml(attr);
    xml += `<${attrName}>${inner}</${attrName}>`;
  }
  return xml;
}

function getNodeTextContent(root, name) {
  var item = root.querySelector(name);
  return item && item.textContent;
}

var METHOD_CALL_XML = "<RestCallMethod xmlns:i=\"http://www.w3.org/2001/XMLSchema-instance\">{payload}</RestCallMethod>";

function restCallMethod(options) {
  options.method = "POST";
  options.headers = { "Content-Type": "application/xml" };
  options.data = METHOD_CALL_XML.replace("{payload}", objToXML(options.data));
  options.format = "document";
  // options.url = options.url.replace("RestPortalProvider", "JsonPortalProvider");
  // options.headers = { "Content-Type": "application/json" };
  // options.data = JSON.stringify(options.data);
  // options.format = "json";
  return request(options)
    .map((data) => RestCallResult(data, options.url, options.ScriptInfo));
}

request.escapeXml = escapeXml;
request.RequestError = RequestError;
request.RestCallMethodError = RestCallMethodError;
request.RestCallResult = RestCallResult;
request.getNodeTextContent = getNodeTextContent;

module.exports = request;
