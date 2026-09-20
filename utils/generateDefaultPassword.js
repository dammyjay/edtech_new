// A random default password for accounts created without one specified
// (bulk CSV imports, admin-created users who leave the password field
// blank). Previously several call sites hardcoded the literal "12345678"
// for every such account — since the login email for bulk-created
// students is also deterministic (name@schoolschool.com), that meant
// anyone who knew a student's name and school could log in as them.
//
// Alphabet avoids visually-ambiguous characters (0/O, 1/l/I) since these
// values sometimes end up printed on physical cards or read aloud.
const crypto = require("crypto");

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";

module.exports = function generateDefaultPassword(length = 10) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return out;
};
