import urlJoin from 'url-join';
import urlParse from 'url-parse';
import inherits from 'inherits';
import { btoa } from 'pouchdb-binary-utils';
import Axios from 'axios';

function axios(opts) {
  opts = Object.assign({ withCredentials: true }, opts);
  return Axios(opts)
  .then(function (res) {
    return res.data;
  })
  .catch(function (err) {
    // console.log('err', err.message, err.request.method, err.request._header)
    if (err.response.data) {
      Object.assign(err, err.response.data);
      if (err.response.statusText)
        {Object.assign(err, {
          name: err.response.statusText.toLowerCase(),
          status: err.response.status
        });}
    }
    throw err;
  });
}

function getBaseUrl(db) {
  // Parse database url
  let url;
  if (typeof db.getUrl === 'function') { // pouchdb pre-6.0.0
    url = urlParse(db.getUrl());
  } else { // pouchdb post-6.0.0
    // Use PouchDB.defaults' prefix, if any
    let prefix = db.__opts && db.__opts.prefix ? db.__opts.prefix + '/' : '';
    url = urlParse(prefix + db.name);
  }

  // Compute parent path for databases not hosted on domain root (see #215)
  let path = url.pathname;
  path = path.substr(-1, 1) === '/' ? path.substr(0, -1) : path;
  let parentPath = path.split('/').slice(0, -1).join('/');

  return url.origin + parentPath;
}

function getConfigUrl(db, nodeName) {
  return urlJoin(getBaseUrl(db), (nodeName ? '/_node/' + nodeName : '') + '/_config');
}

function getUsersUrl(db) {
  return urlJoin(getBaseUrl(db), '/_users');
}

function getSessionUrl(db) {
  return urlJoin(getBaseUrl(db), '/_session');
}

function getBasicAuthHeaders(db) {
  var auth;

  if (db.__opts.auth) {
    auth = db.__opts.auth;
  } else {
    var url = urlParse(db.name);
    if (url.auth) {
      auth = url;
    }
  }

  if (!auth) {
    return {};
  }

  var str = auth.username + ':' + auth.password;
  var token = btoa(unescape(encodeURIComponent(str)));
  return {Authorization: 'Basic ' + token};
}

function AuthError(message) {
  this.status = 400;
  this.name = 'authentication_error';
  this.message = message;
  this.error = true;
  try {
    Error.captureStackTrace(this, AuthError);
  } catch (e) {}
}

inherits(AuthError, Error);

function isBinaryObject(object) {
  return object instanceof Buffer;
}

// most of this is borrowed from lodash.isPlainObject:
// https://github.com/fis-components/lodash.isplainobject/
// blob/29c358140a74f252aeb08c9eb28bef86f2217d4a/index.js

const funcToString = Function.prototype.toString;
const objectCtorString = funcToString.call(Object);

function cloneBuffer(buf) {
  let result;
  if ((Buffer.hasOwnProperty('from') && typeof Buffer.from === 'function')) {
    result = Buffer.from(buf);
  } else {
    result = new Buffer(buf.length);
    buf.copy(result);
  }
  return result;
}
function isPlainObject(value) {
  var proto = Object.getPrototypeOf(value);
  /* istanbul ignore if */
  if (proto === null) { // not sure when this happens, but I guess it can
    return true;
  }
  var Ctor = proto.constructor;
  return (typeof Ctor == 'function' &&
    Ctor instanceof Ctor && funcToString.call(Ctor) == objectCtorString);
}

function clone(object) {
  var newObject;
  var i;
  var len;

  if (!object || typeof object !== 'object') {
    return object;
  }

  if (Array.isArray(object)) {
    newObject = [];
    for (i = 0, len = object.length; i < len; i++) {
      newObject[i] = clone(object[i]);
    }
    return newObject;
  }

  // special case: to avoid inconsistencies between IndexedDB
  // and other backends, we automatically stringify Dates
  if (object instanceof Date) {
    return object.toISOString();
  }

  if (isBinaryObject(object)) {
    return cloneBuffer(object);
  }

  if (!isPlainObject(object)) {
    return object; // don't clone objects like Workers
  }

  newObject = {};
  for (i in object) {
    /* istanbul ignore else */
    if (Object.prototype.hasOwnProperty.call(object, i)) {
      var value = clone(object[i]);
      if (typeof value !== 'undefined') {
        newObject[i] = value;
      }
    }
  }
  return newObject;
}

function getMembership(opts) {
  var db = this;
  if (!opts) {
    opts = {};
  }

  var url = getBaseUrl(db) + '/_membership';
  var ajaxOpts = Object.assign({
    method: 'GET',
    url: url,
    headers: getBasicAuthHeaders(db),
  }, opts.ajax || {});
  return axios(ajaxOpts);
}

function signUpAdmin(username, password, opts) {
  var db = this;

  if (['http', 'https'].indexOf(db.type()) === -1) {
    return Promise.reject(new AuthError('This plugin only works for the http/https adapter. ' +
      'So you should use new PouchDB("http://mysite.com:5984/mydb") instead.'));
  } else if (!username) {
    return Promise.reject(new AuthError('You must provide a username'));
  } else if (!password) {
    return Promise.reject(new AuthError('You must provide a password'));
  }
  if (!opts) {
    opts = {};
  }

  return db.getMembership(opts)
  .catch(function (error) {
    if (error.error !== 'illegal_database_name') {throw error;}
    return error;
  })
  .then(function (membership) {
    var nodeName;
    if (membership instanceof Error) {
      // Some couchdb-1.x-like server
      nodeName = undefined;
    } else {
      // Some couchdb-2.x-like server
      nodeName = membership.all_nodes[0];
    }

    var configUrl = getConfigUrl(db, nodeName);
    var url = (opts.configUrl || configUrl) + '/admins/' + encodeURIComponent(username);
    var ajaxOpts = Object.assign({
      method: 'PUT',
      url: url,
      processData: false,
      headers: getBasicAuthHeaders(db),
      data: '"' + password + '"',
    }, opts.ajax || {});
    return axios(ajaxOpts);
  });
}

function deleteAdmin(username, opts) {
  var db = this;
  if (!opts) {
    opts = {};
  }
  if (['http', 'https'].indexOf(db.type()) === -1) {
    return Promise.reject(new AuthError('This plugin only works for the http/https adapter. ' +
      'So you should use new PouchDB("http://mysite.com:5984/mydb") instead.'));
  } else if (!username) {
    return Promise.reject(new AuthError('You must provide a username'));
  }

  return db.getMembership(opts)
  .catch(function (error) {
    if (error.error !== 'illegal_database_name') {throw error;}
    return error;
  })
  .then(function (membership) {
    var nodeName;
    if (membership instanceof Error) {
      // Some couchdb-1.x-like server
      nodeName = undefined;
    } else {
      // Some couchdb-2.x-like server
      nodeName = membership.all_nodes[0];
    }

    var configUrl = getConfigUrl(db, nodeName);
    var url = (opts.configUrl || configUrl) + '/admins/' + encodeURIComponent(username);
    var ajaxOpts = Object.assign({
      method: 'DELETE',
      url: url,
      processData: false,
      headers: getBasicAuthHeaders(db),
    }, opts.ajax || {});
    return axios(ajaxOpts);
  });
}

function logIn(username, password, opts) {
  var db = this;
  if (!opts) {
    opts = {};
  }

  if (['http', 'https'].indexOf(db.type()) === -1) {
    return Promise.reject(new AuthError('this plugin only works for the http/https adapter'));
  }

  if (!username) {
    return Promise.reject(new AuthError('you must provide a username'));
  } else if (!password) {
    return Promise.reject(new AuthError('you must provide a password'));
  }

  var ajaxOpts = Object.assign({
    method: 'POST',
    url: getSessionUrl(db),
    headers: Object.assign({'Content-Type': 'application/json'}, getBasicAuthHeaders(db)),
    data: {name: username, password: password},
  }, opts.ajax || {});
  // ajaxCore(ajaxOpts, wrapError(callback));
  return axios(ajaxOpts).then(res => {
    if (res.ok && opts.basicAuth !== false) {
      if (!db.__opts) {
        db.__opts = {};
      }
      db.__opts.auth = {username, password};
    }
    return res;
  });
}

function logOut(opts) {
  var db = this;
  if (!opts) {
    opts = {};
  }
  var ajaxOpts = Object.assign({
    method: 'DELETE',
    url: getSessionUrl(db),
    headers: getBasicAuthHeaders(db),
  }, opts.ajax || {});
  // ajaxCore(ajaxOpts, wrapError(callback));
  // let result;
  // try {
  //   result = await axios(ajaxOpts);
  // } catch (err) {
  //   if (err.status !== 401) throw err;
  // }
  // if (db.__opts && db.__opts.auth) db.__opts.auth = null;
  // return result;

  return axios(ajaxOpts)
  .catch(err => {
    if (err.status !== 401) {
      throw err;
    }
  })
  .then(res => {
    if (db.__opts && db.__opts.auth) {
      db.__opts.auth = null;
    }
    return res;
  });
}

function getSession(opts) {
  var db = this;
  if (!opts) {
    opts = {};
  }
  var url = getSessionUrl(db);

  var ajaxOpts = Object.assign({
    method: 'GET',
    url: url,
    headers: getBasicAuthHeaders(db),
  }, opts.ajax || {});
  // ajaxCore(ajaxOpts, wrapError(callback));
  return axios(ajaxOpts);
}

var getUsersDatabaseUrl = function () {
  var db = this;
  return getUsersUrl(db);
};

function updateUser(db, user, opts) {
  var reservedWords = [
    '_id',
    '_rev',
    'name',
    'type',
    'roles',
    'password',
    'password_scheme',
    'iterations',
    'derived_key',
    'salt',
  ];

  if (opts.metadata) {
    for (var key in opts.metadata) {
      if (opts.metadata.hasOwnProperty(key) && reservedWords.indexOf(key) !== -1) {
        return Promise.reject(new AuthError('cannot use reserved word in metadata: "' + key + '"'));
      }
    }
    user = Object.assign(user, opts.metadata);
  }

  if (opts.roles) {
    user = Object.assign(user, {roles: opts.roles});
  }

  var url = getUsersUrl(db) + '/' + encodeURIComponent(user._id);
  var ajaxOpts = Object.assign({
    method: 'PUT',
    url: url,
    data: user,
    headers: getBasicAuthHeaders(db),
  }, opts.ajax || {});
  // ajaxCore(ajaxOpts, wrapError(callback));
  return axios(ajaxOpts);
}

function signUp(username, password, opts) {
  var db = this;
  if (!opts) {
    opts = {};
  }
  if (['http', 'https'].indexOf(db.type()) === -1) {
    return Promise.reject(new AuthError('This plugin only works for the http/https adapter. ' +
      'So you should use new PouchDB("http://mysite.com:5984/mydb") instead.'));
  } else if (!username) {
    return Promise.reject(new AuthError('You must provide a username'));
  } else if (!password) {
    return Promise.reject(new AuthError('You must provide a password'));
  }

  var userId = 'org.couchdb.user:' + username;
  var user = {
    name: username,
    password: password,
    roles: [],
    type: 'user',
    _id: userId,
  };

  return updateUser(db, user, opts);
}

function getUser(username, opts) {
  var db = this;
  if (!opts) {
    opts = {};
  }
  if (!username) {
    return Promise.reject(new AuthError('you must provide a username'));
  }

  var url = getUsersUrl(db);
  var ajaxOpts = Object.assign({
    method: 'GET',
    url: url + '/' + encodeURIComponent('org.couchdb.user:' + username),
    headers: getBasicAuthHeaders(db),
  }, opts.ajax || {});
  // ajaxCore(ajaxOpts, wrapError(callback));
  return axios(ajaxOpts);
}

function putUser(username, opts) {
  var db = this;
  if (!opts) {
    opts = {};
  }
  if (['http', 'https'].indexOf(db.type()) === -1) {
    return Promise.reject(new AuthError('This plugin only works for the http/https adapter. ' +
      'So you should use new PouchDB("http://mysite.com:5984/mydb") instead.'));
  } else if (!username) {
    return Promise.reject(new AuthError('You must provide a username'));
  }

  return db.getUser(username, opts).then(function (user) {
    return updateUser(db, user, opts);
  });
}

function deleteUser(username, opts) {
  var db = this;
  if (!opts) {
    opts = {};
  }
  if (['http', 'https'].indexOf(db.type()) === -1) {
    return Promise.reject(new AuthError('This plugin only works for the http/https adapter. ' +
      'So you should use new PouchDB("http://mysite.com:5984/mydb") instead.'));
  } else if (!username) {
    return Promise.reject(new AuthError('You must provide a username'));
  }

  return db.getUser(username, opts).then(function (user) {
    var url = getUsersUrl(db) + '/' + encodeURIComponent(user._id) + '?rev=' + user._rev;
    var ajaxOpts = Object.assign({
      method: 'DELETE',
      url: url,
      headers: getBasicAuthHeaders(db),
    }, opts.ajax || {});
    // ajaxCore(ajaxOpts, wrapError(callback));
    return axios(ajaxOpts);
  });
}

function changePassword(username, password, opts) {
  var db = this;
  if (!opts) {
    opts = {};
  }
  if (['http', 'https'].indexOf(db.type()) === -1) {
    return Promise.reject(new AuthError('This plugin only works for the http/https adapter. ' +
      'So you should use new PouchDB("http://mysite.com:5984/mydb") instead.'));
  } else if (!username) {
    return Promise.reject(new AuthError('You must provide a username'));
  } else if (!password) {
    return Promise.reject(new AuthError('You must provide a password'));
  }

  return db.getUser(username, opts).then(function (user) {
    user.password = password;

    var url = getUsersUrl(db) + '/' + encodeURIComponent(user._id);
    var ajaxOpts = Object.assign({
      method: 'PUT',
      url: url,
      headers: getBasicAuthHeaders(db),
      data: user,
    }, opts.ajax || {});
    // ajaxCore(ajaxOpts, wrapError(callback));
    return axios(ajaxOpts);
  });
}

function changeUsername(oldUsername, newUsername, opts) {
  var db = this;
  var USERNAME_PREFIX = 'org.couchdb.user:';
  var updateUser = function (user, opts) {
    var url = getUsersUrl(db) + '/' + encodeURIComponent(user._id);
    var updateOpts = Object.assign({
      method: 'PUT',
      url: url,
      headers: getBasicAuthHeaders(db),
      data: user,
    }, opts.ajax);
    return axios(updateOpts);
  };
  if (!opts) {
    opts = {};
  }
  opts.ajax = opts.ajax || {};
  if (['http', 'https'].indexOf(db.type()) === -1) {
    return Promise.reject(new AuthError('This plugin only works for the http/https adapter. ' +
      'So you should use new PouchDB("http://mysite.com:5984/mydb") instead.'));
  }
  if (!newUsername) {
    return Promise.reject(new AuthError('You must provide a new username'));
  }
  if (!oldUsername) {
    return Promise.reject(new AuthError('You must provide a username to rename'));
  }

  return db.getUser(newUsername, opts)
  .then(function () {
    var error = new AuthError('user already exists');
    error.taken = true;
    throw error;
  }, function () {
    return db.getUser(oldUsername, opts);
  })
  .then(function (user) {
    var newUser = clone(user);
    delete newUser._rev;
    newUser._id = USERNAME_PREFIX + newUsername;
    newUser.name = newUsername;
    newUser.roles = opts.roles || user.roles || {};
    return updateUser(newUser, opts).then(function () {
      user._deleted = true;
      return updateUser(user, opts);
    });
  });
  // .then(function (res) {
  //   callback(null, res);
  // })
  // .catch(callback);
}

var plugin = {};

plugin.login = logIn;
plugin.logIn = logIn;
plugin.logout = logOut;
plugin.logOut = logOut;
plugin.getSession = getSession;

plugin.getMembership = getMembership;
plugin.signUpAdmin = signUpAdmin;
plugin.deleteAdmin = deleteAdmin;

plugin.getUsersDatabaseUrl = getUsersDatabaseUrl;
plugin.signup = signUp;
plugin.signUp = signUp;
plugin.getUser = getUser;
plugin.putUser = putUser;
plugin.deleteUser = deleteUser;
plugin.changePassword = changePassword;
plugin.changeUsername = changeUsername;

if (typeof window !== 'undefined' && window.PouchDB) {
  window.PouchDB.plugin(plugin);
}

export default plugin;
