async function issueSessionCookie(payload, secret) {
  throw new Error("not implemented");
}

async function readSessionCookie(cookieHeader, secret) {
  throw new Error("not implemented");
}

function clearSessionCookie() {
  throw new Error("not implemented");
}

module.exports = {
  issueSessionCookie,
  readSessionCookie,
  clearSessionCookie
};
