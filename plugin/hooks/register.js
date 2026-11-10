var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/lz-string/libs/lz-string.js
var require_lz_string = __commonJS({
  "node_modules/lz-string/libs/lz-string.js"(exports, module) {
    var LZString = (function() {
      var f = String.fromCharCode;
      var keyStrBase64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
      var keyStrUriSafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
      var baseReverseDic = {};
      function getBaseValue(alphabet, character) {
        if (!baseReverseDic[alphabet]) {
          baseReverseDic[alphabet] = {};
          for (var i = 0; i < alphabet.length; i++) {
            baseReverseDic[alphabet][alphabet.charAt(i)] = i;
          }
        }
        return baseReverseDic[alphabet][character];
      }
      var LZString2 = {
        compressToBase64: function(input) {
          if (input == null) return "";
          var res = LZString2._compress(input, 6, function(a) {
            return keyStrBase64.charAt(a);
          });
          switch (res.length % 4) {
            // To produce valid Base64
            default:
            // When could this happen ?
            case 0:
              return res;
            case 1:
              return res + "===";
            case 2:
              return res + "==";
            case 3:
              return res + "=";
          }
        },
        decompressFromBase64: function(input) {
          if (input == null) return "";
          if (input == "") return null;
          return LZString2._decompress(input.length, 32, function(index) {
            return getBaseValue(keyStrBase64, input.charAt(index));
          });
        },
        compressToUTF16: function(input) {
          if (input == null) return "";
          return LZString2._compress(input, 15, function(a) {
            return f(a + 32);
          }) + " ";
        },
        decompressFromUTF16: function(compressed) {
          if (compressed == null) return "";
          if (compressed == "") return null;
          return LZString2._decompress(compressed.length, 16384, function(index) {
            return compressed.charCodeAt(index) - 32;
          });
        },
        //compress into uint8array (UCS-2 big endian format)
        compressToUint8Array: function(uncompressed) {
          var compressed = LZString2.compress(uncompressed);
          var buf = new Uint8Array(compressed.length * 2);
          for (var i = 0, TotalLen = compressed.length; i < TotalLen; i++) {
            var current_value = compressed.charCodeAt(i);
            buf[i * 2] = current_value >>> 8;
            buf[i * 2 + 1] = current_value % 256;
          }
          return buf;
        },
        //decompress from uint8array (UCS-2 big endian format)
        decompressFromUint8Array: function(compressed) {
          if (compressed === null || compressed === void 0) {
            return LZString2.decompress(compressed);
          } else {
            var buf = new Array(compressed.length / 2);
            for (var i = 0, TotalLen = buf.length; i < TotalLen; i++) {
              buf[i] = compressed[i * 2] * 256 + compressed[i * 2 + 1];
            }
            var result = [];
            buf.forEach(function(c) {
              result.push(f(c));
            });
            return LZString2.decompress(result.join(""));
          }
        },
        //compress into a string that is already URI encoded
        compressToEncodedURIComponent: function(input) {
          if (input == null) return "";
          return LZString2._compress(input, 6, function(a) {
            return keyStrUriSafe.charAt(a);
          });
        },
        //decompress from an output of compressToEncodedURIComponent
        decompressFromEncodedURIComponent: function(input) {
          if (input == null) return "";
          if (input == "") return null;
          input = input.replace(/ /g, "+");
          return LZString2._decompress(input.length, 32, function(index) {
            return getBaseValue(keyStrUriSafe, input.charAt(index));
          });
        },
        compress: function(uncompressed) {
          return LZString2._compress(uncompressed, 16, function(a) {
            return f(a);
          });
        },
        _compress: function(uncompressed, bitsPerChar, getCharFromInt) {
          if (uncompressed == null) return "";
          var i, value, context_dictionary = {}, context_dictionaryToCreate = {}, context_c = "", context_wc = "", context_w = "", context_enlargeIn = 2, context_dictSize = 3, context_numBits = 2, context_data = [], context_data_val = 0, context_data_position = 0, ii;
          for (ii = 0; ii < uncompressed.length; ii += 1) {
            context_c = uncompressed.charAt(ii);
            if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
              context_dictionary[context_c] = context_dictSize++;
              context_dictionaryToCreate[context_c] = true;
            }
            context_wc = context_w + context_c;
            if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) {
              context_w = context_wc;
            } else {
              if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
                if (context_w.charCodeAt(0) < 256) {
                  for (i = 0; i < context_numBits; i++) {
                    context_data_val = context_data_val << 1;
                    if (context_data_position == bitsPerChar - 1) {
                      context_data_position = 0;
                      context_data.push(getCharFromInt(context_data_val));
                      context_data_val = 0;
                    } else {
                      context_data_position++;
                    }
                  }
                  value = context_w.charCodeAt(0);
                  for (i = 0; i < 8; i++) {
                    context_data_val = context_data_val << 1 | value & 1;
                    if (context_data_position == bitsPerChar - 1) {
                      context_data_position = 0;
                      context_data.push(getCharFromInt(context_data_val));
                      context_data_val = 0;
                    } else {
                      context_data_position++;
                    }
                    value = value >> 1;
                  }
                } else {
                  value = 1;
                  for (i = 0; i < context_numBits; i++) {
                    context_data_val = context_data_val << 1 | value;
                    if (context_data_position == bitsPerChar - 1) {
                      context_data_position = 0;
                      context_data.push(getCharFromInt(context_data_val));
                      context_data_val = 0;
                    } else {
                      context_data_position++;
                    }
                    value = 0;
                  }
                  value = context_w.charCodeAt(0);
                  for (i = 0; i < 16; i++) {
                    context_data_val = context_data_val << 1 | value & 1;
                    if (context_data_position == bitsPerChar - 1) {
                      context_data_position = 0;
                      context_data.push(getCharFromInt(context_data_val));
                      context_data_val = 0;
                    } else {
                      context_data_position++;
                    }
                    value = value >> 1;
                  }
                }
                context_enlargeIn--;
                if (context_enlargeIn == 0) {
                  context_enlargeIn = Math.pow(2, context_numBits);
                  context_numBits++;
                }
                delete context_dictionaryToCreate[context_w];
              } else {
                value = context_dictionary[context_w];
                for (i = 0; i < context_numBits; i++) {
                  context_data_val = context_data_val << 1 | value & 1;
                  if (context_data_position == bitsPerChar - 1) {
                    context_data_position = 0;
                    context_data.push(getCharFromInt(context_data_val));
                    context_data_val = 0;
                  } else {
                    context_data_position++;
                  }
                  value = value >> 1;
                }
              }
              context_enlargeIn--;
              if (context_enlargeIn == 0) {
                context_enlargeIn = Math.pow(2, context_numBits);
                context_numBits++;
              }
              context_dictionary[context_wc] = context_dictSize++;
              context_w = String(context_c);
            }
          }
          if (context_w !== "") {
            if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
              if (context_w.charCodeAt(0) < 256) {
                for (i = 0; i < context_numBits; i++) {
                  context_data_val = context_data_val << 1;
                  if (context_data_position == bitsPerChar - 1) {
                    context_data_position = 0;
                    context_data.push(getCharFromInt(context_data_val));
                    context_data_val = 0;
                  } else {
                    context_data_position++;
                  }
                }
                value = context_w.charCodeAt(0);
                for (i = 0; i < 8; i++) {
                  context_data_val = context_data_val << 1 | value & 1;
                  if (context_data_position == bitsPerChar - 1) {
                    context_data_position = 0;
                    context_data.push(getCharFromInt(context_data_val));
                    context_data_val = 0;
                  } else {
                    context_data_position++;
                  }
                  value = value >> 1;
                }
              } else {
                value = 1;
                for (i = 0; i < context_numBits; i++) {
                  context_data_val = context_data_val << 1 | value;
                  if (context_data_position == bitsPerChar - 1) {
                    context_data_position = 0;
                    context_data.push(getCharFromInt(context_data_val));
                    context_data_val = 0;
                  } else {
                    context_data_position++;
                  }
                  value = 0;
                }
                value = context_w.charCodeAt(0);
                for (i = 0; i < 16; i++) {
                  context_data_val = context_data_val << 1 | value & 1;
                  if (context_data_position == bitsPerChar - 1) {
                    context_data_position = 0;
                    context_data.push(getCharFromInt(context_data_val));
                    context_data_val = 0;
                  } else {
                    context_data_position++;
                  }
                  value = value >> 1;
                }
              }
              context_enlargeIn--;
              if (context_enlargeIn == 0) {
                context_enlargeIn = Math.pow(2, context_numBits);
                context_numBits++;
              }
              delete context_dictionaryToCreate[context_w];
            } else {
              value = context_dictionary[context_w];
              for (i = 0; i < context_numBits; i++) {
                context_data_val = context_data_val << 1 | value & 1;
                if (context_data_position == bitsPerChar - 1) {
                  context_data_position = 0;
                  context_data.push(getCharFromInt(context_data_val));
                  context_data_val = 0;
                } else {
                  context_data_position++;
                }
                value = value >> 1;
              }
            }
            context_enlargeIn--;
            if (context_enlargeIn == 0) {
              context_enlargeIn = Math.pow(2, context_numBits);
              context_numBits++;
            }
          }
          value = 2;
          for (i = 0; i < context_numBits; i++) {
            context_data_val = context_data_val << 1 | value & 1;
            if (context_data_position == bitsPerChar - 1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
          while (true) {
            context_data_val = context_data_val << 1;
            if (context_data_position == bitsPerChar - 1) {
              context_data.push(getCharFromInt(context_data_val));
              break;
            } else context_data_position++;
          }
          return context_data.join("");
        },
        decompress: function(compressed) {
          if (compressed == null) return "";
          if (compressed == "") return null;
          return LZString2._decompress(compressed.length, 32768, function(index) {
            return compressed.charCodeAt(index);
          });
        },
        _decompress: function(length, resetValue, getNextValue) {
          var dictionary = [], next, enlargeIn = 4, dictSize = 4, numBits = 3, entry = "", result = [], i, w, bits, resb, maxpower, power, c, data = { val: getNextValue(0), position: resetValue, index: 1 };
          for (i = 0; i < 3; i += 1) {
            dictionary[i] = i;
          }
          bits = 0;
          maxpower = Math.pow(2, 2);
          power = 1;
          while (power != maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
          }
          switch (next = bits) {
            case 0:
              bits = 0;
              maxpower = Math.pow(2, 8);
              power = 1;
              while (power != maxpower) {
                resb = data.val & data.position;
                data.position >>= 1;
                if (data.position == 0) {
                  data.position = resetValue;
                  data.val = getNextValue(data.index++);
                }
                bits |= (resb > 0 ? 1 : 0) * power;
                power <<= 1;
              }
              c = f(bits);
              break;
            case 1:
              bits = 0;
              maxpower = Math.pow(2, 16);
              power = 1;
              while (power != maxpower) {
                resb = data.val & data.position;
                data.position >>= 1;
                if (data.position == 0) {
                  data.position = resetValue;
                  data.val = getNextValue(data.index++);
                }
                bits |= (resb > 0 ? 1 : 0) * power;
                power <<= 1;
              }
              c = f(bits);
              break;
            case 2:
              return "";
          }
          dictionary[3] = c;
          w = c;
          result.push(c);
          while (true) {
            if (data.index > length) {
              return "";
            }
            bits = 0;
            maxpower = Math.pow(2, numBits);
            power = 1;
            while (power != maxpower) {
              resb = data.val & data.position;
              data.position >>= 1;
              if (data.position == 0) {
                data.position = resetValue;
                data.val = getNextValue(data.index++);
              }
              bits |= (resb > 0 ? 1 : 0) * power;
              power <<= 1;
            }
            switch (c = bits) {
              case 0:
                bits = 0;
                maxpower = Math.pow(2, 8);
                power = 1;
                while (power != maxpower) {
                  resb = data.val & data.position;
                  data.position >>= 1;
                  if (data.position == 0) {
                    data.position = resetValue;
                    data.val = getNextValue(data.index++);
                  }
                  bits |= (resb > 0 ? 1 : 0) * power;
                  power <<= 1;
                }
                dictionary[dictSize++] = f(bits);
                c = dictSize - 1;
                enlargeIn--;
                break;
              case 1:
                bits = 0;
                maxpower = Math.pow(2, 16);
                power = 1;
                while (power != maxpower) {
                  resb = data.val & data.position;
                  data.position >>= 1;
                  if (data.position == 0) {
                    data.position = resetValue;
                    data.val = getNextValue(data.index++);
                  }
                  bits |= (resb > 0 ? 1 : 0) * power;
                  power <<= 1;
                }
                dictionary[dictSize++] = f(bits);
                c = dictSize - 1;
                enlargeIn--;
                break;
              case 2:
                return result.join("");
            }
            if (enlargeIn == 0) {
              enlargeIn = Math.pow(2, numBits);
              numBits++;
            }
            if (dictionary[c]) {
              entry = dictionary[c];
            } else {
              if (c === dictSize) {
                entry = w + w.charAt(0);
              } else {
                return null;
              }
            }
            result.push(entry);
            dictionary[dictSize++] = w + entry.charAt(0);
            enlargeIn--;
            w = entry;
            if (enlargeIn == 0) {
              enlargeIn = Math.pow(2, numBits);
              numBits++;
            }
          }
        }
      };
      return LZString2;
    })();
    if (typeof define === "function" && define.amd) {
      define(function() {
        return LZString;
      });
    } else if (typeof module !== "undefined" && module != null) {
      module.exports = LZString;
    } else if (typeof angular !== "undefined" && angular != null) {
      angular.module("LZString", []).factory("LZString", function() {
        return LZString;
      });
    }
  }
});

// ../plugin/src/register.tsx
import { atom, memberOf, read, update } from "claude-code";

// ../frontend/src/catalog/componentCatalog.ts
var componentCatalog = [
  // Generic Shapes
  { type: "shape", techStack: "Rectangle", category: "Generic Shapes", searchTerms: "rectangle box square shape" },
  { type: "shape", techStack: "Circle", category: "Generic Shapes", searchTerms: "circle round shape" },
  { type: "shape", techStack: "Diamond", category: "Generic Shapes", searchTerms: "diamond rhombus shape decision" },
  { type: "shape", techStack: "Cylinder", category: "Generic Shapes", searchTerms: "cylinder shape storage" },
  { type: "shape", techStack: "Cloud", category: "Generic Shapes", searchTerms: "cloud shape" },
  { type: "shape", techStack: "Actor", category: "Generic Shapes", searchTerms: "actor user person human shape", aliases: ["User", "Client", "Customer", "Person"] },
  { type: "shape", techStack: "Browser", category: "Generic Shapes", searchTerms: "browser web client user", aliases: ["Web Browser", "Web Client"] },
  { type: "shape", techStack: "Mobile App", category: "Generic Shapes", searchTerms: "mobile app ios android client user", aliases: ["Mobile", "Mobile Client", "iOS", "iOS App", "Android", "Android App"] },
  { type: "shape", techStack: "Note", category: "Generic Shapes", searchTerms: "note document comment annotation", kind: "other" },
  // Generic components: one per kind, for a node whose product does not matter or is not listed.
  { type: "service", techStack: "Service", category: "Generic Components", searchTerms: "service microservice backend server application", aliases: ["Microservice", "Backend", "Backend Service", "App Server", "Application Server", "Server", "API Server"] },
  { type: "service", techStack: "Worker", category: "Generic Components", searchTerms: "worker background job consumer processor", aliases: ["Background Worker", "Job Worker", "Consumer", "Job Runner"] },
  { type: "database", techStack: "Database", category: "Generic Components", searchTerms: "database relational sql db", aliases: ["DB", "RDBMS", "SQL Database", "Relational Database", "SQL"] },
  { type: "database", techStack: "NoSQL Database", category: "Generic Components", searchTerms: "nosql key value document wide column database", profile: "nosql", aliases: ["NoSQL", "NoSQL DB", "Key-Value Store", "KV Store", "Document Store", "Document Database", "Wide-Column Store"] },
  { type: "cache", techStack: "Cache", category: "Generic Components", searchTerms: "cache in-memory key value", aliases: ["In-Memory Cache", "Distributed Cache"] },
  { type: "queue", techStack: "Message Queue", category: "Generic Components", searchTerms: "queue message job task", aliases: ["Queue", "Job Queue", "Task Queue"] },
  { type: "broker", techStack: "Message Broker", category: "Generic Components", searchTerms: "message broker topic stream event bus log pub sub", aliases: ["Broker", "Event Bus", "Topic", "Event Stream", "Stream", "Event Log"] },
  { type: "storage", techStack: "Object Storage", category: "Generic Components", searchTerms: "object storage blob bucket files", aliases: ["Object Store", "Blob Store", "Blob Storage", "Bucket", "Storage", "File Storage"] },
  { type: "cdn", techStack: "CDN", category: "Generic Components", searchTerms: "cdn content delivery network edge cache", kind: "cdn", aliases: ["Content Delivery Network", "Edge Cache"] },
  { type: "cdn", techStack: "Load Balancer", category: "Generic Components", searchTerms: "load balancer lb reverse proxy", kind: "loadbalancer", aliases: ["LB", "Reverse Proxy", "L7 Load Balancer", "L4 Load Balancer"] },
  { type: "cdn", techStack: "API Gateway", category: "Generic Components", searchTerms: "api gateway", kind: "gateway", aliases: ["Gateway", "Edge Gateway"] },
  { type: "cdn", techStack: "DNS", category: "Generic Components", searchTerms: "dns domain name system", kind: "dns", aliases: ["Domain Name System", "DNS Server"] },
  { type: "cdn", techStack: "WAF", category: "Generic Components", searchTerms: "waf web application firewall edge", kind: "edge", aliases: ["Web Application Firewall", "Firewall"] },
  { type: "serverless", techStack: "Function", category: "Generic Components", searchTerms: "function serverless faas", aliases: ["Serverless Function", "Serverless", "FaaS", "Cloud Function"] },
  { type: "database", techStack: "Search Engine", category: "Generic Components", searchTerms: "search engine index full text", kind: "search", aliases: ["Search", "Search Index", "Full-Text Search", "Search Service"] },
  { type: "database", techStack: "Data Warehouse", category: "Generic Components", searchTerms: "data warehouse lake olap analytics", kind: "analytics", aliases: ["Warehouse", "Data Lake", "OLAP", "Analytics DB", "Analytics Database", "Time Series DB", "Time Series Database", "TSDB"] },
  // Services
  { type: "service", techStack: "REST API", category: "Services", searchTerms: "rest api http service endpoint", aliases: ["REST", "API", "HTTP API", "Web API", "REST Service"] },
  { type: "service", techStack: "GraphQL", category: "Services", searchTerms: "graphql api service query", aliases: ["GraphQL API", "Apollo"] },
  { type: "service", techStack: "gRPC", category: "Services", searchTerms: "grpc rpc service", aliases: ["gRPC Service", "RPC"] },
  { type: "service", techStack: "WebSocket", category: "Services", searchTerms: "websocket ws realtime service", aliases: ["WebSockets", "WS", "Socket.IO", "WebSocket Server"] },
  { type: "service", techStack: "SOAP API", category: "Services", searchTerms: "soap api xml service", aliases: ["SOAP"] },
  // Languages and frameworks: a service written in it.
  { type: "service", techStack: "Spring Boot", category: "Languages & Frameworks", searchTerms: "spring boot java kotlin service", aliases: ["Spring", "Spring Framework", "Spring WebFlux"] },
  { type: "service", techStack: "Kotlin", category: "Languages & Frameworks", searchTerms: "kotlin ktor jvm service", aliases: ["Ktor"] },
  { type: "service", techStack: "Java", category: "Languages & Frameworks", searchTerms: "java jvm service", aliases: ["JVM", "Quarkus", "Micronaut"] },
  { type: "service", techStack: "Go", category: "Languages & Frameworks", searchTerms: "go golang service", aliases: ["Golang"] },
  { type: "service", techStack: "Node.js", category: "Languages & Frameworks", searchTerms: "node nodejs javascript typescript express nestjs service", aliases: ["Node", "Express", "Express.js", "NestJS", "TypeScript", "JavaScript"] },
  { type: "service", techStack: "Python", category: "Languages & Frameworks", searchTerms: "python service" },
  { type: "service", techStack: "Django", category: "Languages & Frameworks", searchTerms: "django python service" },
  { type: "service", techStack: "FastAPI", category: "Languages & Frameworks", searchTerms: "fastapi python service" },
  { type: "service", techStack: "Flask", category: "Languages & Frameworks", searchTerms: "flask python service" },
  { type: "service", techStack: "Ruby on Rails", category: "Languages & Frameworks", searchTerms: "ruby on rails service", aliases: ["Rails", "Ruby"] },
  { type: "service", techStack: ".NET", category: "Languages & Frameworks", searchTerms: "dotnet .net asp.net c# service", aliases: ["ASP.NET", "ASP.NET Core", "dotnet", "C#"] },
  { type: "service", techStack: "PHP", category: "Languages & Frameworks", searchTerms: "php laravel symfony service", aliases: ["Laravel", "Symfony"] },
  { type: "service", techStack: "Rust", category: "Languages & Frameworks", searchTerms: "rust axum actix service", aliases: ["Axum", "Actix"] },
  { type: "service", techStack: "Elixir", category: "Languages & Frameworks", searchTerms: "elixir phoenix erlang service", aliases: ["Phoenix", "Erlang"] },
  // Containers and platforms
  { type: "container", techStack: "Kubernetes", category: "Containers & Platforms", searchTerms: "kubernetes k8s container pod", aliases: ["K8s", "Kubernetes Pod", "Pod"] },
  { type: "container", techStack: "Docker", category: "Containers & Platforms", searchTerms: "docker container", aliases: ["Container", "Docker Container"] },
  { type: "compute", techStack: "VM", category: "Containers & Platforms", searchTerms: "vm virtual machine server instance", aliases: ["Virtual Machine", "Instance", "Bare Metal"] },
  { type: "serverless", techStack: "Cloudflare Workers", category: "Containers & Platforms", searchTerms: "cloudflare workers edge functions serverless", aliases: ["Workers"] },
  // AWS Serverless
  { type: "serverless", techStack: "AWS Lambda", category: "AWS Services", searchTerms: "aws lambda serverless function", aliases: ["Lambda", "Amazon Lambda"] },
  { type: "serverless", techStack: "AWS API Gateway", category: "AWS Services", searchTerms: "aws api gateway rest", kind: "gateway", aliases: ["Amazon API Gateway"] },
  // AWS Compute
  { type: "compute", techStack: "AWS EC2", category: "AWS Services", searchTerms: "aws ec2 compute instance vm", aliases: ["EC2", "Amazon EC2"] },
  { type: "container", techStack: "AWS ECS", category: "AWS Services", searchTerms: "aws ecs container docker", aliases: ["ECS", "Amazon ECS"] },
  { type: "container", techStack: "AWS EKS", category: "AWS Services", searchTerms: "aws eks kubernetes k8s", aliases: ["EKS", "Amazon EKS"] },
  { type: "container", techStack: "AWS Fargate", category: "AWS Services", searchTerms: "aws fargate serverless container", aliases: ["Fargate"] },
  // AWS Storage
  { type: "storage", techStack: "AWS S3", category: "AWS Services", searchTerms: "aws s3 storage bucket object", aliases: ["S3", "Amazon S3", "S3 Bucket"] },
  { type: "storage", techStack: "AWS EBS", category: "AWS Services", searchTerms: "aws ebs storage volume disk", aliases: ["EBS", "Amazon EBS"] },
  { type: "storage", techStack: "AWS EFS", category: "AWS Services", searchTerms: "aws efs storage file system", aliases: ["EFS", "Amazon EFS"] },
  // AWS Database
  { type: "database", techStack: "AWS RDS", category: "AWS Services", searchTerms: "aws rds database relational sql", aliases: ["RDS", "Amazon RDS"] },
  { type: "database", techStack: "AWS DynamoDB", category: "AWS Services", searchTerms: "aws dynamodb database nosql", profile: "nosql", aliases: ["Amazon DynamoDB", "Dynamo"] },
  { type: "cache", techStack: "AWS ElastiCache", category: "AWS Services", searchTerms: "aws elasticache redis memcached cache", aliases: ["ElastiCache", "Amazon ElastiCache"] },
  { type: "database", techStack: "AWS Aurora", category: "AWS Services", searchTerms: "aws aurora database mysql postgresql", aliases: ["Aurora", "Amazon Aurora", "Aurora PostgreSQL", "Aurora MySQL", "Aurora Serverless"] },
  { type: "database", techStack: "AWS DocumentDB", category: "AWS Services", searchTerms: "aws documentdb mongodb document database", aliases: ["DocumentDB", "Amazon DocumentDB"] },
  { type: "database", techStack: "AWS Keyspaces", category: "AWS Services", searchTerms: "aws keyspaces cassandra nosql", profile: "nosql", aliases: ["Keyspaces", "Amazon Keyspaces"] },
  { type: "database", techStack: "AWS Neptune", category: "AWS Services", searchTerms: "aws neptune graph database", aliases: ["Neptune", "Amazon Neptune"] },
  { type: "database", techStack: "AWS Redshift", category: "AWS Services", searchTerms: "aws redshift data warehouse analytics", kind: "analytics", aliases: ["Redshift", "Amazon Redshift"] },
  { type: "database", techStack: "AWS Athena", category: "AWS Services", searchTerms: "aws athena query s3 analytics", kind: "analytics", aliases: ["Athena", "Amazon Athena"] },
  { type: "database", techStack: "AWS OpenSearch", category: "AWS Services", searchTerms: "aws opensearch elasticsearch search", kind: "search", aliases: ["Amazon OpenSearch", "OpenSearch Service", "AWS Elasticsearch"] },
  // AWS Messaging
  { type: "queue", techStack: "AWS SQS", category: "AWS Services", searchTerms: "aws sqs queue message", aliases: ["Amazon SQS", "Simple Queue Service"] },
  { type: "broker", techStack: "AWS SNS", category: "AWS Services", searchTerms: "aws sns notification topic pubsub", aliases: ["SNS", "Amazon SNS", "Simple Notification Service"] },
  { type: "broker", techStack: "AWS EventBridge", category: "AWS Services", searchTerms: "aws eventbridge event bus", aliases: ["EventBridge", "Amazon EventBridge"] },
  { type: "broker", techStack: "AWS Kinesis", category: "AWS Services", searchTerms: "aws kinesis stream data", aliases: ["Kinesis", "Amazon Kinesis", "Kinesis Data Streams"] },
  { type: "broker", techStack: "AWS MSK", category: "AWS Services", searchTerms: "aws msk managed kafka stream", aliases: ["MSK", "Amazon MSK", "Managed Streaming for Kafka"] },
  // AWS CDN/Network
  { type: "cdn", techStack: "AWS CloudFront", category: "AWS Services", searchTerms: "aws cloudfront cdn edge", kind: "cdn", aliases: ["CloudFront", "Amazon CloudFront"] },
  { type: "cdn", techStack: "AWS Route53", category: "AWS Services", searchTerms: "aws route53 dns domain", kind: "dns", aliases: ["Route53", "Amazon Route 53"] },
  { type: "cdn", techStack: "AWS Load Balancer", category: "AWS Services", searchTerms: "aws alb elb nlb load balancer", kind: "loadbalancer", aliases: ["ALB", "NLB", "ELB", "AWS ALB", "AWS NLB", "AWS ELB", "Application Load Balancer", "Network Load Balancer", "Elastic Load Balancer", "Elastic Load Balancing"] },
  { type: "cdn", techStack: "AWS WAF", category: "AWS Services", searchTerms: "aws waf web application firewall", kind: "edge", aliases: ["Amazon WAF"] },
  { type: "cdn", techStack: "AWS Global Accelerator", category: "AWS Services", searchTerms: "aws global accelerator anycast edge", kind: "edge", aliases: ["Global Accelerator"] },
  // AWS third-party style services
  { type: "external", techStack: "AWS SES", category: "AWS Services", searchTerms: "aws ses email simple email service", aliases: ["SES", "Amazon SES", "Simple Email Service"] },
  { type: "external", techStack: "AWS Cognito", category: "AWS Services", searchTerms: "aws cognito auth identity users", aliases: ["Cognito", "Amazon Cognito"] },
  // GCP Serverless
  { type: "serverless", techStack: "GCP Cloud Functions", category: "GCP Services", searchTerms: "gcp google cloud functions serverless", aliases: ["Cloud Functions", "Google Cloud Functions"] },
  { type: "serverless", techStack: "GCP Cloud Run", category: "GCP Services", searchTerms: "gcp google cloud run serverless container", aliases: ["Cloud Run", "Google Cloud Run"] },
  { type: "serverless", techStack: "GCP App Engine", category: "GCP Services", searchTerms: "gcp google app engine paas", aliases: ["App Engine", "Google App Engine"] },
  // GCP Compute
  { type: "compute", techStack: "GCP Compute Engine", category: "GCP Services", searchTerms: "gcp google compute engine vm instance", aliases: ["Compute Engine", "GCE", "Google Compute Engine"] },
  { type: "container", techStack: "GCP GKE", category: "GCP Services", searchTerms: "gcp google gke kubernetes k8s", aliases: ["GKE", "Google Kubernetes Engine"] },
  // GCP Storage
  { type: "storage", techStack: "GCP Cloud Storage", category: "GCP Services", searchTerms: "gcp google cloud storage bucket object", aliases: ["GCS", "Cloud Storage", "Google Cloud Storage"] },
  { type: "storage", techStack: "GCP Persistent Disk", category: "GCP Services", searchTerms: "gcp google persistent disk storage", aliases: ["Persistent Disk"] },
  // GCP Database
  { type: "database", techStack: "GCP Cloud SQL", category: "GCP Services", searchTerms: "gcp google cloud sql database", aliases: ["Cloud SQL", "Google Cloud SQL"] },
  { type: "database", techStack: "GCP Firestore", category: "GCP Services", searchTerms: "gcp google firestore database nosql", profile: "nosqlStrong", aliases: ["Firestore", "Cloud Firestore", "Datastore"] },
  { type: "database", techStack: "GCP Bigtable", category: "GCP Services", searchTerms: "gcp google bigtable database nosql", profile: "nosqlStrong", aliases: ["Bigtable", "Cloud Bigtable"] },
  { type: "database", techStack: "GCP Spanner", category: "GCP Services", searchTerms: "gcp google spanner database sql", profile: "nosqlStrong", aliases: ["Spanner", "Cloud Spanner", "Google Spanner"] },
  { type: "database", techStack: "GCP BigQuery", category: "GCP Services", searchTerms: "gcp google bigquery data warehouse analytics", kind: "analytics", aliases: ["BigQuery", "Google BigQuery"] },
  { type: "cache", techStack: "GCP Memorystore", category: "GCP Services", searchTerms: "gcp google memorystore redis memcached cache", aliases: ["Memorystore"] },
  // GCP Messaging
  { type: "broker", techStack: "GCP Pub/Sub", category: "GCP Services", searchTerms: "gcp google pubsub pub/sub message queue", aliases: ["Pub/Sub", "Google Pub/Sub", "Cloud Pub/Sub"] },
  // GCP CDN/Network
  { type: "cdn", techStack: "GCP Cloud CDN", category: "GCP Services", searchTerms: "gcp google cloud cdn edge", kind: "cdn", aliases: ["Cloud CDN", "Google Cloud CDN"] },
  { type: "cdn", techStack: "GCP Cloud DNS", category: "GCP Services", searchTerms: "gcp google cloud dns domain", kind: "dns", aliases: ["Cloud DNS", "Google Cloud DNS"] },
  { type: "cdn", techStack: "GCP Load Balancing", category: "GCP Services", searchTerms: "gcp google load balancing", kind: "loadbalancer", aliases: ["Cloud Load Balancing", "GCP Load Balancer", "Google Cloud Load Balancing"] },
  { type: "cdn", techStack: "GCP Apigee", category: "GCP Services", searchTerms: "gcp google apigee api gateway management", kind: "gateway", aliases: ["Apigee"] },
  // Azure Serverless
  { type: "serverless", techStack: "Azure Functions", category: "Azure Services", searchTerms: "azure functions serverless", aliases: ["Azure Function"] },
  { type: "serverless", techStack: "Azure Logic Apps", category: "Azure Services", searchTerms: "azure logic apps workflow", aliases: ["Logic Apps"] },
  { type: "serverless", techStack: "Azure API Management", category: "Azure Services", searchTerms: "azure api management gateway", kind: "gateway", aliases: ["APIM", "Azure APIM"] },
  // Azure Compute
  { type: "compute", techStack: "Azure VM", category: "Azure Services", searchTerms: "azure vm virtual machine compute", aliases: ["Azure Virtual Machine", "Azure Virtual Machines"] },
  { type: "container", techStack: "Azure AKS", category: "Azure Services", searchTerms: "azure aks kubernetes k8s", aliases: ["AKS", "Azure Kubernetes Service"] },
  { type: "container", techStack: "Azure Container Instances", category: "Azure Services", searchTerms: "azure container instances aci", aliases: ["ACI"] },
  { type: "service", techStack: "Azure App Service", category: "Azure Services", searchTerms: "azure app service web apps paas", aliases: ["App Service", "Azure Web Apps"] },
  // Azure Storage
  { type: "storage", techStack: "Azure Blob Storage", category: "Azure Services", searchTerms: "azure blob storage object", aliases: ["Azure Blob", "Azure Storage"] },
  { type: "storage", techStack: "Azure Files", category: "Azure Services", searchTerms: "azure files storage file system" },
  { type: "storage", techStack: "Azure Disk Storage", category: "Azure Services", searchTerms: "azure disk storage volume", aliases: ["Azure Managed Disks"] },
  // Azure Database
  { type: "database", techStack: "Azure SQL", category: "Azure Services", searchTerms: "azure sql database", aliases: ["Azure SQL Database"] },
  { type: "database", techStack: "Azure Cosmos DB", category: "Azure Services", searchTerms: "azure cosmos db database nosql", profile: "nosql", aliases: ["Cosmos DB", "Cosmos"] },
  { type: "database", techStack: "Azure Database for PostgreSQL", category: "Azure Services", searchTerms: "azure postgresql database", aliases: ["Azure PostgreSQL", "Azure Postgres"] },
  { type: "database", techStack: "Azure Database for MySQL", category: "Azure Services", searchTerms: "azure mysql database", aliases: ["Azure MySQL"] },
  { type: "cache", techStack: "Azure Cache for Redis", category: "Azure Services", searchTerms: "azure redis cache", aliases: ["Azure Redis"] },
  { type: "database", techStack: "Azure AI Search", category: "Azure Services", searchTerms: "azure ai cognitive search", kind: "search", aliases: ["Azure Cognitive Search", "Azure Search"] },
  // Azure Messaging
  { type: "broker", techStack: "Azure Service Bus", category: "Azure Services", searchTerms: "azure service bus queue message", aliases: ["Service Bus"] },
  { type: "broker", techStack: "Azure Event Hubs", category: "Azure Services", searchTerms: "azure event hubs stream", aliases: ["Event Hubs", "Event Hub"] },
  { type: "broker", techStack: "Azure Event Grid", category: "Azure Services", searchTerms: "azure event grid", aliases: ["Event Grid"] },
  { type: "queue", techStack: "Azure Queue Storage", category: "Azure Services", searchTerms: "azure queue storage message", aliases: ["Azure Queue", "Azure Queues"] },
  // Azure CDN/Network
  { type: "cdn", techStack: "Azure CDN", category: "Azure Services", searchTerms: "azure cdn edge", kind: "cdn" },
  { type: "cdn", techStack: "Azure DNS", category: "Azure Services", searchTerms: "azure dns domain", kind: "dns" },
  { type: "cdn", techStack: "Azure Front Door", category: "Azure Services", searchTerms: "azure front door cdn", kind: "cdn", aliases: ["Front Door"] },
  { type: "cdn", techStack: "Azure Load Balancer", category: "Azure Services", searchTerms: "azure load balancer", kind: "loadbalancer" },
  { type: "cdn", techStack: "Azure Application Gateway", category: "Azure Services", searchTerms: "azure application gateway l7 load balancer", kind: "loadbalancer", aliases: ["Application Gateway", "Azure App Gateway"] },
  // Traditional Databases
  { type: "database", techStack: "PostgreSQL", category: "Databases", searchTerms: "postgresql postgres sql database", aliases: ["Postgres", "PG", "PostGIS", "pgvector"] },
  { type: "database", techStack: "MySQL", category: "Databases", searchTerms: "mysql sql database", aliases: ["Percona"] },
  { type: "database", techStack: "MongoDB", category: "Databases", searchTerms: "mongodb mongo nosql database", profile: "nosqlStrong", aliases: ["Mongo", "MongoDB Atlas"] },
  { type: "database", techStack: "Redis", category: "Databases", searchTerms: "redis cache database key-value", kind: "cache", aliases: ["Redis Cluster", "Redis Cache"] },
  { type: "database", techStack: "DynamoDB", category: "Databases", searchTerms: "dynamodb nosql database aws", profile: "nosql" },
  { type: "database", techStack: "Cassandra", category: "Databases", searchTerms: "cassandra nosql database", profile: "nosql", aliases: ["Apache Cassandra", "DataStax"] },
  { type: "database", techStack: "CouchDB", category: "Databases", searchTerms: "couchdb nosql database", profile: "nosql", aliases: ["Apache CouchDB"] },
  { type: "database", techStack: "Elasticsearch", category: "Databases", searchTerms: "elasticsearch search database", kind: "search", aliases: ["Elastic", "Elastic Search", "ES"] },
  { type: "database", techStack: "Neo4j", category: "Databases", searchTerms: "neo4j graph database", aliases: ["Graph Database", "Graph DB"] },
  { type: "database", techStack: "InfluxDB", category: "Databases", searchTerms: "influxdb timeseries database", kind: "analytics", aliases: ["Influx"] },
  { type: "database", techStack: "TimescaleDB", category: "Databases", searchTerms: "timescaledb timeseries postgresql database", kind: "analytics", aliases: ["Timescale"] },
  { type: "database", techStack: "MariaDB", category: "Databases", searchTerms: "mariadb mysql sql database", aliases: ["Maria"] },
  { type: "database", techStack: "SQLite", category: "Databases", searchTerms: "sqlite sql database" },
  { type: "database", techStack: "Oracle", category: "Databases", searchTerms: "oracle sql database", aliases: ["Oracle DB", "Oracle Database"] },
  { type: "database", techStack: "SQL Server", category: "Databases", searchTerms: "sql server mssql database microsoft", aliases: ["MSSQL", "MS SQL", "Microsoft SQL Server"] },
  { type: "database", techStack: "CockroachDB", category: "Databases", searchTerms: "cockroachdb distributed sql database", profile: "nosqlStrong", aliases: ["Cockroach"] },
  { type: "database", techStack: "YugabyteDB", category: "Databases", searchTerms: "yugabytedb distributed sql database", profile: "nosqlStrong", aliases: ["Yugabyte"] },
  { type: "database", techStack: "TiDB", category: "Databases", searchTerms: "tidb distributed sql mysql database", profile: "nosqlStrong" },
  { type: "database", techStack: "Vitess", category: "Databases", searchTerms: "vitess sharded mysql planetscale database", profile: "nosqlStrong", aliases: ["PlanetScale"] },
  { type: "database", techStack: "ScyllaDB", category: "Databases", searchTerms: "scylladb cassandra nosql database", profile: "nosql", aliases: ["Scylla"] },
  { type: "database", techStack: "Couchbase", category: "Databases", searchTerms: "couchbase nosql document database", profile: "nosql" },
  { type: "database", techStack: "HBase", category: "Databases", searchTerms: "hbase hadoop wide column nosql database", profile: "nosqlStrong", aliases: ["Apache HBase"] },
  { type: "database", techStack: "etcd", category: "Databases", searchTerms: "etcd key value consensus configuration" },
  { type: "database", techStack: "ZooKeeper", category: "Databases", searchTerms: "zookeeper coordination consensus configuration", aliases: ["Apache ZooKeeper"] },
  // Cache & In-Memory
  { type: "cache", techStack: "Memcached", category: "Cache & In-Memory", searchTerms: "memcached cache memory", aliases: ["Memcache"] },
  { type: "cache", techStack: "Hazelcast", category: "Cache & In-Memory", searchTerms: "hazelcast cache memory" },
  { type: "cache", techStack: "Aerospike", category: "Cache & In-Memory", searchTerms: "aerospike cache database" },
  { type: "cache", techStack: "Valkey", category: "Cache & In-Memory", searchTerms: "valkey redis cache memory" },
  { type: "cache", techStack: "KeyDB", category: "Cache & In-Memory", searchTerms: "keydb redis cache memory" },
  { type: "cache", techStack: "Dragonfly", category: "Cache & In-Memory", searchTerms: "dragonfly dragonflydb redis cache memory", aliases: ["DragonflyDB"] },
  // Queues & Brokers: a queue hands each message to one consumer; a broker routes or logs it for many.
  { type: "broker", techStack: "Kafka", category: "Queues & Brokers", searchTerms: "kafka message broker event stream log topic", aliases: ["Apache Kafka", "Confluent", "Confluent Kafka", "Kafka Topic"] },
  { type: "broker", techStack: "RabbitMQ", category: "Queues & Brokers", searchTerms: "rabbitmq message broker queue amqp", aliases: ["Rabbit", "AMQP"] },
  { type: "queue", techStack: "SQS", category: "Queues & Brokers", searchTerms: "sqs queue aws message" },
  { type: "queue", techStack: "Redis Queue", category: "Queues & Brokers", searchTerms: "redis queue message", aliases: ["Redis Streams", "Redis Pub/Sub"] },
  { type: "broker", techStack: "NATS", category: "Queues & Brokers", searchTerms: "nats message broker stream", aliases: ["NATS JetStream", "JetStream"] },
  { type: "broker", techStack: "Apache Pulsar", category: "Queues & Brokers", searchTerms: "pulsar message broker stream", aliases: ["Pulsar"] },
  { type: "broker", techStack: "ActiveMQ", category: "Queues & Brokers", searchTerms: "activemq message broker queue", aliases: ["Apache ActiveMQ", "Amazon MQ"] },
  { type: "queue", techStack: "ZeroMQ", category: "Queues & Brokers", searchTerms: "zeromq zmq message queue", aliases: ["ZMQ", "0MQ"] },
  { type: "broker", techStack: "Redpanda", category: "Queues & Brokers", searchTerms: "redpanda kafka message broker stream" },
  // Search
  { type: "database", techStack: "OpenSearch", category: "Search", searchTerms: "opensearch elasticsearch search", kind: "search" },
  { type: "database", techStack: "Solr", category: "Search", searchTerms: "solr lucene search", kind: "search", aliases: ["Apache Solr"] },
  { type: "database", techStack: "Meilisearch", category: "Search", searchTerms: "meilisearch search", kind: "search" },
  { type: "database", techStack: "Typesense", category: "Search", searchTerms: "typesense search", kind: "search" },
  { type: "database", techStack: "Algolia", category: "Search", searchTerms: "algolia hosted search", kind: "search" },
  // Analytics
  { type: "database", techStack: "Snowflake", category: "Analytics", searchTerms: "snowflake data warehouse analytics", kind: "analytics" },
  { type: "database", techStack: "ClickHouse", category: "Analytics", searchTerms: "clickhouse olap analytics columnar", kind: "analytics" },
  { type: "database", techStack: "Apache Druid", category: "Analytics", searchTerms: "druid olap analytics", kind: "analytics", aliases: ["Druid"] },
  { type: "database", techStack: "Apache Pinot", category: "Analytics", searchTerms: "pinot olap analytics", kind: "analytics", aliases: ["Pinot"] },
  { type: "database", techStack: "Databricks", category: "Analytics", searchTerms: "databricks lakehouse spark analytics", kind: "analytics" },
  { type: "database", techStack: "Prometheus", category: "Analytics", searchTerms: "prometheus metrics time series monitoring", kind: "analytics" },
  // Storage
  { type: "storage", techStack: "MinIO", category: "Storage", searchTerms: "minio s3 object storage" },
  { type: "storage", techStack: "Cloudflare R2", category: "Storage", searchTerms: "cloudflare r2 object storage", aliases: ["R2"] },
  { type: "storage", techStack: "Ceph", category: "Storage", searchTerms: "ceph object block storage" },
  { type: "storage", techStack: "HDFS", category: "Storage", searchTerms: "hdfs hadoop file system storage", aliases: ["Hadoop", "Hadoop HDFS"] },
  // CDN, proxies and gateways
  { type: "cdn", techStack: "Cloudflare", category: "CDN & Edge", searchTerms: "cloudflare cdn edge", kind: "cdn", aliases: ["Cloudflare CDN"] },
  { type: "cdn", techStack: "Fastly", category: "CDN & Edge", searchTerms: "fastly cdn edge", kind: "cdn" },
  { type: "cdn", techStack: "Akamai", category: "CDN & Edge", searchTerms: "akamai cdn edge", kind: "cdn" },
  { type: "cdn", techStack: "nginx", category: "CDN & Edge", searchTerms: "nginx reverse proxy load balancer web server", kind: "loadbalancer", aliases: ["NGINX Plus", "OpenResty"] },
  { type: "cdn", techStack: "Envoy", category: "CDN & Edge", searchTerms: "envoy proxy load balancer service mesh", kind: "loadbalancer", aliases: ["Envoy Proxy"] },
  { type: "cdn", techStack: "HAProxy", category: "CDN & Edge", searchTerms: "haproxy load balancer proxy", kind: "loadbalancer" },
  { type: "cdn", techStack: "Traefik", category: "CDN & Edge", searchTerms: "traefik reverse proxy load balancer", kind: "loadbalancer" },
  { type: "cdn", techStack: "Kubernetes Ingress", category: "CDN & Edge", searchTerms: "kubernetes ingress controller load balancer", kind: "loadbalancer", aliases: ["Ingress", "Ingress Controller", "K8s Ingress"] },
  { type: "cdn", techStack: "Kong", category: "CDN & Edge", searchTerms: "kong api gateway", kind: "gateway", aliases: ["Kong Gateway"] },
  { type: "cdn", techStack: "Spring Cloud Gateway", category: "CDN & Edge", searchTerms: "spring cloud gateway api gateway", kind: "gateway" },
  // External Systems
  { type: "external", techStack: "Third Party API", category: "External Systems", searchTerms: "third party api external", aliases: ["External API", "External Service", "Third-Party API", "3rd Party API", "Partner API", "SaaS", "Webhook"] },
  { type: "external", techStack: "Payment Gateway", category: "External Systems", searchTerms: "payment gateway stripe paypal", aliases: ["Payment Provider", "Payments API", "Payment Processor", "PSP"] },
  { type: "external", techStack: "Auth Service", category: "External Systems", searchTerms: "auth authentication authorization", aliases: ["Identity Provider", "IdP", "OAuth Provider", "SSO"] },
  { type: "external", techStack: "Email Service", category: "External Systems", searchTerms: "email service sendgrid mailgun", aliases: ["Email", "Email Provider", "SMTP"] },
  { type: "external", techStack: "SMS Service", category: "External Systems", searchTerms: "sms service twilio", aliases: ["SMS", "SMS Gateway", "SMS Provider"] },
  { type: "external", techStack: "Push Service", category: "External Systems", searchTerms: "push notification service mobile", aliases: ["Push Notifications", "Push Notification Service", "Push Provider"] },
  { type: "external", techStack: "Analytics Service", category: "External Systems", searchTerms: "analytics service google analytics", aliases: ["Google Analytics", "Segment", "Mixpanel", "Amplitude"] },
  { type: "external", techStack: "Stripe", category: "External Systems", searchTerms: "stripe payments" },
  { type: "external", techStack: "PayPal", category: "External Systems", searchTerms: "paypal payments" },
  { type: "external", techStack: "Adyen", category: "External Systems", searchTerms: "adyen payments" },
  { type: "external", techStack: "Braintree", category: "External Systems", searchTerms: "braintree payments" },
  { type: "external", techStack: "Twilio", category: "External Systems", searchTerms: "twilio sms voice" },
  { type: "external", techStack: "SendGrid", category: "External Systems", searchTerms: "sendgrid email" },
  { type: "external", techStack: "Mailgun", category: "External Systems", searchTerms: "mailgun email" },
  { type: "external", techStack: "Auth0", category: "External Systems", searchTerms: "auth0 identity login" },
  { type: "external", techStack: "Okta", category: "External Systems", searchTerms: "okta identity sso" },
  { type: "external", techStack: "Google Maps", category: "External Systems", searchTerms: "google maps geocoding routing", aliases: ["Google Maps API", "Maps API"] },
  { type: "external", techStack: "APNs", category: "External Systems", searchTerms: "apns apple push notification", aliases: ["Apple Push Notification Service", "Apple Push"] },
  { type: "external", techStack: "FCM", category: "External Systems", searchTerms: "fcm firebase cloud messaging push", aliases: ["Firebase Cloud Messaging", "Firebase Messaging"] },
  { type: "external", techStack: "OpenAI", category: "External Systems", searchTerms: "openai llm ai api", aliases: ["OpenAI API", "LLM API", "LLM"] },
  // Text & Annotations
  { type: "text", techStack: "Text Note", category: "Annotations", searchTerms: "text note annotation comment label" },
  { type: "text", techStack: "Sticky Note", category: "Annotations", searchTerms: "sticky note annotation comment" },
  { type: "text", techStack: "Comment", category: "Annotations", searchTerms: "comment annotation note text" },
  // Grouping
  { type: "group", techStack: "Logical Group", category: "Grouping", searchTerms: "group container boundary logical" },
  { type: "group", techStack: "Network Boundary", category: "Grouping", searchTerms: "group network boundary vpc subnet" },
  { type: "group", techStack: "Security Zone", category: "Grouping", searchTerms: "group security zone boundary" },
  { type: "group", techStack: "Service Group", category: "Grouping", searchTerms: "group service container boundary" }
];
var techKey = (name) => name.toLowerCase().replace(/[^a-z0-9#+]/g, "");
var entries = componentCatalog;
var byKey = /* @__PURE__ */ new Map();
for (const c of entries) {
  for (const name of [c.techStack, ...c.aliases ?? []]) {
    const key = techKey(name);
    if (!byKey.has(key)) byKey.set(key, c);
  }
}
var VERSION = /[\s-]*v?\d+(\.(\d+|x))*\s*$/i;
function findTech(name) {
  const exact = byKey.get(techKey(name));
  if (exact) return exact;
  const unversioned = name.replace(VERSION, "");
  return unversioned !== name && unversioned.trim() ? byKey.get(techKey(unversioned)) : void 0;
}
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_2, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost2 = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost2);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
function suggestTech(name, accept = (c) => c.type !== "group" && c.type !== "text" && c.techStack !== "Note") {
  const key = techKey(name);
  if (!key) return void 0;
  let best;
  for (const c of entries) {
    if (!accept(c)) continue;
    for (const candidate of [c.techStack, ...c.aliases ?? []]) {
      const d = editDistance(key, techKey(candidate));
      if (!best || d < best.d) best = { tech: c.techStack, d };
    }
  }
  if (best && best.d <= Math.max(1, Math.floor(key.length / 4))) return best.tech;
  const words = name.toLowerCase().split(/[^a-z0-9.#+]+/).filter(Boolean);
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const found = byKey.get(techKey(words.slice(i, i + n).join(" ")));
      if (found && accept(found) && techKey(words.slice(i, i + n).join("")).length >= 3) return found.techStack;
    }
  }
  return void 0;
}

// ../frontend/src/dsl/lexer.ts
var IDENT_START = /[A-Za-z_]/;
var IDENT_PART = /[A-Za-z0-9_]/;
var TEAM_PART = /[A-Za-z0-9_-]/;
var DIGIT = /[0-9]/;
var LETTER = /[A-Za-z]/;
var HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![A-Za-z0-9_])/;
var SEPARATE_UNIT = /^[ \t]+(rps|rpm|rpd|ms|s|%|usd\/month|usd\/GB|MB\/s|GB\/s)(?![A-Za-z0-9_/])/;
function tokenizeLine(text, line) {
  const tokens = [];
  const diagnostics = [];
  let i = 0;
  const error = (message, col, length) => diagnostics.push({ severity: "error", message, line, col, length });
  while (i < text.length) {
    const ch = text[i];
    if (ch === " " || ch === "	" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "#") {
      const prev = tokens[tokens.length - 1];
      const hex2 = prev?.kind === "ident" && prev.value === "color" ? HEX_COLOR.exec(text.slice(i)) : null;
      if (!hex2) break;
      tokens.push({ kind: "hex", value: hex2[0], col: i + 1, length: hex2[0].length });
      i += hex2[0].length;
      continue;
    }
    const start2 = i;
    if (ch === ":") {
      const raw = stripTrailingComment(text.slice(i + 1));
      tokens.push({ kind: "label", value: raw.trim(), col: start2 + 1, length: text.length - start2 });
      break;
    }
    if (ch === '"') {
      const { value, end, closed } = readString(text, i);
      if (!closed) error("Unterminated string", start2 + 1, text.length - start2);
      tokens.push({ kind: "string", value, col: start2 + 1, length: end - start2 });
      i = end;
      continue;
    }
    if (ch === "[") {
      const close = text.indexOf("]", i + 1);
      if (close === -1) {
        error("Missing ] after tech stack", start2 + 1, text.length - start2);
        tokens.push({ kind: "tech", value: text.slice(i + 1).trim(), col: start2 + 1, length: text.length - start2 });
        break;
      }
      tokens.push({ kind: "tech", value: text.slice(i + 1, close).trim(), col: start2 + 1, length: close + 1 - start2 });
      i = close + 1;
      continue;
    }
    if (ch === "-") {
      const arrow = ["->>", "-->", "->"].find((a) => text.startsWith(a, i));
      const failed = text.startsWith("-x", i) && !IDENT_PART.test(text[i + 2] ?? "");
      if (arrow || failed) {
        const value = arrow ?? "-x";
        tokens.push({ kind: "arrow", value, col: start2 + 1, length: value.length });
        i += value.length;
        continue;
      }
      if (DIGIT.test(text[i + 1] ?? "")) {
        i++;
        while (i < text.length && DIGIT.test(text[i])) i++;
        tokens.push({ kind: "number", value: text.slice(start2, i), col: start2 + 1, length: i - start2 });
        continue;
      }
    }
    if (DIGIT.test(ch)) {
      i = readQuantity(text, i);
      const value = text.slice(start2, i).replace(/[ \t]+/g, "");
      const kind = /^\d+$/.test(value) ? "number" : "quantity";
      tokens.push({ kind, value, col: start2 + 1, length: i - start2 });
      continue;
    }
    if (ch === "=") {
      tokens.push({ kind: "op", value: "=", col: start2 + 1, length: 1 });
      i++;
      continue;
    }
    if (ch === "$" && IDENT_START.test(text[i + 1] ?? "")) {
      i++;
      while (i < text.length && IDENT_PART.test(text[i])) i++;
      tokens.push({ kind: "const", value: text.slice(start2, i), col: start2 + 1, length: i - start2 });
      continue;
    }
    if (ch === "<" || ch === ">") {
      const value = text[i + 1] === "=" ? ch + "=" : ch;
      tokens.push({ kind: "op", value, col: start2 + 1, length: value.length });
      i += value.length;
      continue;
    }
    if (ch === "@") {
      i++;
      while (i < text.length && TEAM_PART.test(text[i])) i++;
      if (i === start2 + 1) error("Expected a team name after @", start2 + 1, 1);
      tokens.push({ kind: "team", value: text.slice(start2 + 1, i), col: start2 + 1, length: i - start2 });
      continue;
    }
    if (ch === "/") {
      while (i < text.length && !/\s/.test(text[i])) i++;
      tokens.push({ kind: "path", value: text.slice(start2, i), col: start2 + 1, length: i - start2 });
      continue;
    }
    if (IDENT_START.test(ch)) {
      const prev = tokens[tokens.length - 1];
      const headerName = prev?.kind === "ident" && prev.value === "header" ? /^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)+/.exec(text.slice(i)) : null;
      if (headerName) {
        i += headerName[0].length;
        tokens.push({ kind: "ident", value: headerName[0], col: start2 + 1, length: i - start2 });
        continue;
      }
      while (i < text.length && IDENT_PART.test(text[i])) i++;
      if (i === start2 + 1 && ch === "x" && text[i] === "$" && IDENT_START.test(text[i + 1] ?? "")) {
        i += 2;
        while (i < text.length && IDENT_PART.test(text[i])) i++;
        tokens.push({ kind: "const", value: text.slice(start2, i), col: start2 + 1, length: i - start2 });
        continue;
      }
      if (/^x\d+$/.test(text.slice(start2, i)) && text[i] === "." && DIGIT.test(text[i + 1] ?? "")) {
        i++;
        while (i < text.length && DIGIT.test(text[i])) i++;
      }
      tokens.push({ kind: "ident", value: text.slice(start2, i), col: start2 + 1, length: i - start2 });
      continue;
    }
    if (ch === "." && IDENT_START.test(text[i + 1] ?? "")) {
      i++;
      while (i < text.length && IDENT_PART.test(text[i])) i++;
      tokens.push({ kind: "tag", value: text.slice(start2 + 1, i), col: start2 + 1, length: i - start2 });
      continue;
    }
    if (ch === "{" || ch === "}" || ch === ",") {
      const kind = ch === "{" ? "lbrace" : ch === "}" ? "rbrace" : "comma";
      tokens.push({ kind, value: ch, col: start2 + 1, length: 1 });
      i++;
      continue;
    }
    error(`Unexpected character '${ch}'`, start2 + 1, 1);
    i++;
  }
  return { tokens, diagnostics };
}
function readQuantity(text, start2) {
  let i = start2;
  while (i < text.length && DIGIT.test(text[i])) i++;
  if (text[i] === "." && DIGIT.test(text[i + 1] ?? "")) {
    i++;
    while (i < text.length && DIGIT.test(text[i])) i++;
  }
  const suffixStart = i;
  if (text[i] === "%") return i + 1;
  while (i < text.length && LETTER.test(text[i])) i++;
  if (i > suffixStart && text[i] === "/" && LETTER.test(text[i + 1] ?? "")) {
    i++;
    while (i < text.length && LETTER.test(text[i])) i++;
  }
  if (/^[kmb]?$/.test(text.slice(suffixStart, i))) {
    const unit = SEPARATE_UNIT.exec(text.slice(i));
    if (unit) i += unit[0].length;
  }
  return i;
}
function readString(text, start2) {
  let value = "";
  let i = start2 + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length) {
      value += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"') return { value, end: i + 1, closed: true };
    value += ch;
    i++;
  }
  return { value, end: text.length, closed: false };
}
function stripTrailingComment(text) {
  let depth = 0;
  let quote2 = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote2) {
      if (ch === "\\") i++;
      else if (ch === quote2) quote2 = null;
      continue;
    }
    if (ch === '"') quote2 = ch;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "#" && depth === 0 && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
  }
  return text;
}
var BracketCounter = class {
  depth = 0;
  inString = false;
  escaped = false;
  /** Adds `text` and returns the depth so far. */
  feed(text) {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (this.escaped) {
        this.escaped = false;
        continue;
      }
      if (this.inString) {
        if (ch === "\\") this.escaped = true;
        else if (ch === '"') this.inString = false;
        continue;
      }
      if (ch === '"') this.inString = true;
      else if (ch === "{" || ch === "[") this.depth++;
      else if (ch === "}" || ch === "]") this.depth--;
    }
    return this.depth;
  }
};
function qualify(tokens) {
  let out;
  for (let i = 0; i < tokens.length; i++) {
    const [t, next] = [tokens[i], tokens[i + 1]];
    const joined = t.kind === "ident" && next?.kind === "tag" && next.col === t.col + t.length;
    if (joined && (tokens[i + 2]?.kind === "arrow" || tokens[i - 1]?.kind === "arrow")) {
      out ??= tokens.slice(0, i);
      out.push({ ...t, value: `${t.value}.${next.value}`, length: t.length + next.length });
      i++;
    } else out?.push(t);
  }
  return out ?? tokens;
}

// ../frontend/src/dsl/paths.ts
var PARAM = /^\{[^{}/]+\}$/;
var ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
function segments(path) {
  return path.split("?")[0].split("/");
}
function isTemplate(path) {
  return segments(path).some((s) => PARAM.test(s));
}
function matchesTemplate(template, path) {
  const t = segments(template);
  const p = segments(path);
  return t.length === p.length && t.every((seg, i) => PARAM.test(seg) ? p[i] !== "" : seg === p[i]);
}
function templatize(path) {
  return segments(path).map((s) => ID_SEGMENT.test(s) ? "{id}" : s).join("/");
}
function split(endpoint) {
  const space = endpoint.indexOf(" ");
  return space === -1 ? { method: "", path: endpoint } : { method: endpoint.slice(0, space), path: endpoint.slice(space + 1) };
}
function endpointGroupKey(endpoint, all) {
  if (isTemplate(endpoint)) return endpoint;
  const { method, path } = split(endpoint);
  const template = all.find((other) => {
    const o = split(other);
    return o.method === method && isTemplate(o.path) && matchesTemplate(o.path, path);
  });
  if (template) return template;
  return method ? `${method} ${templatize(path)}` : templatize(path);
}

// ../frontend/src/dsl/kinds.ts
var KINDS = ["client", "edge", "cdn", "loadbalancer", "gateway", "dns", "service", "function", "cache", "database", "search", "analytics", "queue", "broker", "storage", "external", "other"];
var DATA_STORE_KINDS = ["cache", "database", "search", "analytics", "queue", "broker", "storage"];
var EDGE_KINDS = ["edge", "cdn", "loadbalancer", "gateway", "dns"];
var BY_TECH = new Map(componentCatalog.flatMap((c) => "kind" in c ? [[c.techStack, c.kind]] : []));
var BY_TYPE = {
  shape: "client",
  cdn: "edge",
  service: "service",
  compute: "service",
  container: "service",
  serverless: "function",
  cache: "cache",
  database: "database",
  queue: "queue",
  broker: "broker",
  storage: "storage",
  external: "external"
};
function kindOf(node) {
  if (node.kind !== "component") return "other";
  return node.inferredKind ?? node.resolvedType?.kind ?? BY_TECH.get(node.techStack) ?? BY_TYPE[node.type] ?? "other";
}
var TYPE_OF_KIND = {
  client: "shape",
  edge: "cdn",
  cdn: "cdn",
  loadbalancer: "cdn",
  gateway: "cdn",
  dns: "cdn",
  service: "service",
  function: "serverless",
  cache: "cache",
  database: "database",
  search: "database",
  analytics: "database",
  queue: "queue",
  broker: "broker",
  storage: "storage",
  external: "external",
  other: "shape"
};
var KIND_WORDS = [
  [/\bsms\b|e-?mail|third.?party|3rd.?party|external|saas|webhook/, "external"],
  [/\bcdn\b|edge.?cache|content.?delivery/, "cdn"],
  [/\bdns\b/, "dns"],
  [/load.?balanc|\blb\b|\balb\b|\bnlb\b|proxy|ingress/, "loadbalancer"],
  [/gateway|\bapim?\b.*manage/, "gateway"],
  [/\bwaf\b|firewall/, "edge"],
  [/cache|memcache/, "cache"],
  [/broker|event.?stream|event.?log|\bbus\b|topic|pub.?sub|event.?hub|kafka|kinesis|pulsar|redpanda|jetstream|\bnats\b/, "broker"],
  [/queue|\bmq\b|mq$/, "queue"],
  [/search|lucene|\bindex\b/, "search"],
  [/warehouse|analytic|olap|data.?lake|lakehouse|time.?series|\btsdb\b/, "analytics"],
  [/bucket|blob|object.?stor|storage|\bfs\b|file.?system|\bnas\b|\bdisk\b|volume/, "storage"],
  [/\bdb\b|db$|database|\bsql\b|sql$|nosql|\bstore\b|ledger|key.?value|\bkv\b/, "database"],
  [/lambda|function|serverless|\bfaas\b/, "function"]
];
function kindFromName(tech) {
  const text = tech.toLowerCase();
  return KIND_WORDS.find(([words]) => words.test(text))?.[1];
}
function isKind(word) {
  return KINDS.includes(word);
}
function isDataStore(kind) {
  return DATA_STORE_KINDS.includes(kind);
}
function isEdge(kind) {
  return EDGE_KINDS.includes(kind);
}
function kindMatches(actual, wanted) {
  return actual === wanted || wanted === "edge" && isEdge(actual) || wanted === "queue" && actual === "broker";
}

// ../frontend/src/dsl/quantity.ts
function parseQuantity(text) {
  const m = /^(\d+(?:\.\d+)?)(.*)$/.exec(text.replace(/\s+/g, ""));
  if (!m) return { error: `'${text}' is not a number` };
  const number = Number(m[1]);
  const suffix = m[2];
  const unit = UNITS.get(suffix);
  if (suffix === "" || unit) return unit ? { value: round(number * unit.factor), unit: unit.unit } : { value: number };
  const magnitude = MAGNITUDES.get(suffix[0]);
  const rest = suffix.slice(1);
  const after2 = UNITS.get(rest);
  if (magnitude && (rest === "" || after2)) {
    return after2 ? { value: round(number * magnitude * after2.factor), unit: after2.unit } : { value: round(number * magnitude) };
  }
  return { error: `Unknown unit '${suffix}' in '${text}'; use rps, rpm, rpd, ms, s, %, usd/month, MB/s, GB/s or usd/GB (with k, m or b for thousands, millions, billions)` };
}
var round = (n) => Number(n.toPrecision(12));
var MAGNITUDES = /* @__PURE__ */ new Map([
  ["k", 1e3],
  ["m", 1e6],
  ["b", 1e9]
]);
var UNITS = /* @__PURE__ */ new Map([
  ["rps", { unit: "rps", factor: 1 }],
  ["rpm", { unit: "rps", factor: 1 / 60 }],
  ["rpd", { unit: "rps", factor: 1 / 86400 }],
  ["ms", { unit: "ms", factor: 1 }],
  ["s", { unit: "ms", factor: 1e3 }],
  ["%", { unit: "%", factor: 1 }],
  ["usd/month", { unit: "usd/month", factor: 1 }],
  ["MB/s", { unit: "MBps", factor: 1 }],
  ["GB/s", { unit: "MBps", factor: 1e3 }],
  ["usd/GB", { unit: "usd/GB", factor: 1 }]
]);

// ../frontend/src/dsl/access.ts
var WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
var WRITE_VERBS = [
  "INSERT",
  "UPDATE",
  "UPSERT",
  "DELETE",
  "PUT",
  "SET",
  "WRITE",
  "APPEND",
  "INCR",
  "DECR",
  "LPUSH",
  "RPUSH",
  "ZADD",
  "HSET",
  "GEOADD",
  "PUBLISH",
  "SEND",
  "ENQUEUE",
  "PRODUCE",
  "CHARGE",
  "CREATE",
  // DynamoDB and Redis commands that store data
  "PUTITEM",
  "UPDATEITEM",
  "DELETEITEM",
  "BATCHWRITEITEM",
  "INCRBY",
  "HINCRBY",
  "SADD",
  "XADD",
  "MSET",
  // Plain words for storing something
  "SAVE",
  "STORE",
  "UPLOAD",
  "COMMIT",
  "RECORD",
  "MARK",
  // Claiming a resource changes state: a seat, a driver, stock
  "RESERVE",
  "HOLD",
  "BOOK",
  // Handing something on: a write at the receiver (a queue, a provider), like SEND and PUBLISH
  "EMIT",
  "NOTIFY"
];
function accessOf(httpMethod, label) {
  if (httpMethod) return WRITE_METHODS.includes(httpMethod.toUpperCase()) ? "write" : "read";
  const word = /^\s*"?([A-Za-z_]+)/.exec(label)?.[1];
  return word && WRITE_VERBS.includes(word.toUpperCase()) ? "write" : "read";
}

// ../frontend/src/dsl/palette.ts
var PALETTE = {
  gray: "#6b7280",
  blue: "#3b82f6",
  teal: "#14b8a6",
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
  purple: "#a855f7",
  pink: "#ec4899"
};
var COLOR_NAMES = Object.keys(PALETTE);
var HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function resolveColor(text) {
  if (Object.prototype.hasOwnProperty.call(PALETTE, text)) return PALETTE[text];
  if (!HEX.test(text)) return void 0;
  const digits = text.slice(1).toLowerCase();
  return "#" + (digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits);
}
var CATEGORY_OF_KIND = {
  client: "client",
  edge: "edge",
  cdn: "edge",
  loadbalancer: "edge",
  gateway: "edge",
  dns: "edge",
  service: "service",
  function: "service",
  cache: "data",
  database: "data",
  search: "data",
  analytics: "data",
  storage: "data",
  queue: "queue",
  broker: "queue",
  external: "external",
  other: void 0
};
var CATEGORY_COLOR = {
  client: "gray",
  edge: "purple",
  service: "blue",
  data: "green",
  queue: "orange",
  external: "pink"
};
function categoryOf(kind) {
  return CATEGORY_OF_KIND[kind];
}
function nodeBaseColor(node) {
  if (node.style?.color) return node.style.color;
  if (node.kind !== "component") return void 0;
  const category = categoryOf(kindOf(node));
  return category ? PALETTE[CATEGORY_COLOR[category]] : void 0;
}
function suggestColor(text) {
  const word = text.toLowerCase();
  let best;
  for (const name of COLOR_NAMES) {
    const distance = editDistance2(word, name);
    if (distance <= 2 && (!best || distance < best.distance)) best = { name, distance };
  }
  return best?.name;
}
function editDistance2(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = next;
    }
  }
  return row[b.length];
}

// ../frontend/src/dsl/typesys/types.ts
var ROOT_TYPE = "Component";

// ../frontend/src/dsl/typesys/resolve.ts
var typeKey = techKey;
function lookupType(table, name) {
  const own = table.get(typeKey(name));
  if (own && !own.builtin) return own;
  const tech = findTech(name);
  return tech ? table.get(typeKey(tech.techStack)) : own;
}
function techNamed(name) {
  const tech = findTech(name);
  return tech && typeKey(tech.techStack) === typeKey(name) ? tech.techStack : void 0;
}
function resolveTypes(decls, base = /* @__PURE__ */ new Map()) {
  const diagnostics = [];
  const error = (message, loc) => diagnostics.push({ severity: "error", message, ...loc });
  const warning = (message, loc) => diagnostics.push({ severity: "warning", message, ...loc });
  const byKey2 = /* @__PURE__ */ new Map();
  const order = [];
  for (const decl of decls) {
    const key = typeKey(decl.name);
    const builtin = base.get(key);
    const first = byKey2.get(key);
    if (builtin) error(`Type '${decl.name}' is built in${builtin.name === decl.name ? "" : ` as '${builtin.name}'`}; extend it under another name`, decl.loc);
    else if (first) error(`Duplicate type '${decl.name}' (first declared ${where(first.loc, decl.loc)})`, decl.loc);
    else {
      byKey2.set(key, decl);
      order.push(decl);
    }
  }
  const table = new Map(base);
  const resolving = [];
  const broken = /* @__PURE__ */ new Set();
  const resolve = (decl) => {
    const key = typeKey(decl.name);
    const done = table.get(key);
    if (done) return done;
    let parent;
    const parentName = decl.parent ?? (typeKey(decl.name) === typeKey(ROOT_TYPE) ? void 0 : ROOT_TYPE);
    if (parentName !== void 0) {
      const parentKey = typeKey(parentName);
      const parentDecl = byKey2.get(parentKey);
      const cycleStart = !parentDecl ? -1 : parentDecl === decl ? resolving.length : resolving.indexOf(parentDecl);
      if (cycleStart !== -1) {
        const names = [...resolving.slice(cycleStart), decl, parentDecl].map((d) => d.name);
        error(`Type cycle: ${names.join(" \u2192 ")}`, decl.parentLoc ?? decl.loc);
        parent = table.get(typeKey(ROOT_TYPE));
        broken.add(key);
      } else if (parentDecl) {
        resolving.push(decl);
        parent = resolve(parentDecl);
        resolving.pop();
        if (broken.has(parentKey)) broken.add(key);
      } else {
        parent = base.get(parentKey) ?? lookupType(base, parentName) ?? catalogType(parentName, table);
        if (!parent) {
          broken.add(key);
          const suggestion = suggestType(parentName, [...table.values()].map((t) => t.name).concat([...byKey2.values()].map((d) => d.name)));
          error(`Unknown parent type '${parentName}'${suggestion ? `. Did you mean '${suggestion}'?` : ""}`, decl.parentLoc ?? decl.loc);
          parent = table.get(typeKey(ROOT_TYPE));
        }
      }
    }
    let icon = decl.icon;
    if (icon !== void 0) {
      const tech = findTech(icon);
      if (!tech) {
        const suggestion = suggestTech(icon);
        warning(`Unknown icon '${icon}'${suggestion ? ` (did you mean '${suggestion}'?)` : ""}; the type keeps its inherited icon`, decl.loc);
      }
      icon = tech?.techStack;
    }
    if (icon === void 0 && decl.builtin) icon = techNamed(decl.name);
    const shadowed = decl.builtin ? void 0 : findTech(decl.name);
    if (shadowed) warning(`Type '${decl.name}' has the name of the catalog tech '${shadowed.techStack}'; [${decl.name}] now means this type`, decl.loc);
    icon ??= parent?.icon;
    const kind = decl.kind ?? parent?.kind;
    if (!decl.abstract && !kind && !broken.has(key)) error(`Type '${decl.name}' needs a kind: declare one (kind database) or extend a type that has one`, decl.loc);
    const ownOps = new Set(decl.ops.map((o) => o.name));
    const resolved = {
      name: decl.name,
      abstract: decl.abstract,
      builtin: decl.builtin,
      parents: parent ? [parent.name, ...parent.parents] : [],
      ...kind ? { kind } : {},
      props: { ...parent?.props, ...decl.props },
      ops: [...parent?.ops.filter((o) => !ownOps.has(o.name)) ?? [], ...decl.ops].map((o) => ({ ...o })),
      statuses: union(parent?.statuses ?? [], decl.statuses),
      headers: union(parent?.headers ?? [], decl.headers, (h2) => h2.toLowerCase()),
      ...pick("protocol", decl.protocol ?? parent?.protocol),
      ...pick("icon", icon),
      ...pick("doc", decl.doc ?? parent?.doc),
      loc: decl.loc
    };
    table.set(key, resolved);
    return resolved;
  };
  const types = order.map(resolve);
  return { table, types, diagnostics };
}
function catalogType(name, table) {
  const tech = findTech(name);
  if (!tech) return void 0;
  const root = table.get(typeKey(ROOT_TYPE));
  return {
    name: tech.techStack,
    abstract: false,
    builtin: true,
    parents: root ? [root.name, ...root.parents] : [],
    kind: kindOf({ kind: "component", type: tech.type, techStack: tech.techStack }),
    props: {},
    ops: [],
    statuses: [],
    headers: [],
    icon: tech.techStack,
    loc: { line: 1, col: 1, length: 0, file: "catalog" }
  };
}
function pick(key, value) {
  return value === void 0 ? {} : { [key]: value };
}
function union(inherited, own, key = (v) => v) {
  const seen = new Set(inherited.map(key));
  return [...inherited, ...own.filter((v) => !seen.has(key(v)) && seen.add(key(v)))];
}
function where(first, later) {
  return first.file === later.file ? `on line ${first.line}` : `in ${first.file ?? "the root document"} on line ${first.line}`;
}
function suggestType(name, names) {
  const key = typeKey(name);
  let best;
  let bestDistance = Math.max(2, Math.floor(key.length / 3)) + 1;
  for (const candidate of names) {
    const d = editDistance(key, typeKey(candidate));
    if (d < bestDistance) [best, bestDistance] = [candidate, d];
  }
  return best;
}

// ../frontend/src/dsl/stdlib/sources.gen.ts
var STDLIB_SOURCES = [
  { path: "stdlib/core.proschi", source: `# Proschi standard library: the root types. Bundled with the parser, so every
# diagram sees them. The format is in docs/design/typed-components.md.
#
# Rules for stdlib files:
# - Only \`type\` and \`abstract type\` blocks, blank lines and comments.
# - A type named after a catalog tech stack (src/catalog/componentCatalog.ts)
#   is drawn with that tech's icon and must have the kind the catalog gives it
#   (stdlib.test.ts checks both). Every catalog tech has a type.
# - An abstract type, or any type the catalog does not know, must not share
#   a name or an alias with a catalog tech: the catalog name always wins.
# - Names of the types the catalog does not know, all abstract:
#   - a top level under Component is one word: a layer of a design (Edge,
#     Compute, Data, Messaging, External) or a family of drawings (Caller,
#     Shape, Annotation, Group);
#   - below it, a type is named in English words like a catalog tech, in
#     brackets when there are several, with acronyms written as the catalog
#     writes them (SQL, NoSQL, HTTP): [Coordination Store], Platform;
#   - a type that narrows another one ends with that type's name:
#     [HTTP Service] under Service, [Document NoSQL Database] under
#     [NoSQL Database], [Distributed SQL Database] under Database.
# - Simulation numbers (latencyMs, rps, \u2026) go here only when they equal what
#   sim/profiles.ts already gives the tech, so diagrams simulate as before.
# - An op a practice problem's step already uses must have the access that
#   step has today (dsl/access.ts); stdlib.test.ts checks it.
# - Op names are unique along a type's chain, ignoring case: a parent's
#   upper-case plain words (WRITE, SEND) are not repeated by its children.
# - After editing, run \`npm run gen:stdlib\` to refresh sources.gen.ts.
#
# The top levels: Component, then Caller and Shape (clients), Annotation and
# Group (drawing aids), Edge, Compute, Data, Messaging and External.

abstract type Component {
  doc "Anything drawn on the diagram: the root of every type."
}

# Clients: who sends the first request.

abstract type Caller {
  kind client
  doc "Whoever sends the first request: a person, a browser or an app."
}

type Actor extends Caller {
  doc "A person who uses the system."
}

type Browser extends Caller {
  doc "A web browser running the site's pages."
}

type [Mobile App] extends Caller {
  doc "An iOS or Android app on the user's phone."
}

abstract type Shape {
  kind client
  doc "A plain shape, drawn without a product icon; it simulates as a client."
}

type Rectangle extends Shape {
  doc "A plain rectangle."
}

type Circle extends Shape {
  doc "A plain circle."
}

type Diamond extends Shape {
  doc "A plain diamond, often used for a decision."
}

type Cylinder extends Shape {
  doc "A plain cylinder, the usual sketch of storage."
}

type Cloud extends Shape {
  doc "A plain cloud shape, for the internet or a provider you do not detail."
}

# Drawing aids: they take no part in the simulation.

abstract type Annotation {
  kind other
  doc "A note on the diagram that takes no part in the simulation."
}

type Note extends Annotation {
  doc "A note shape with text, for remarks next to the components."
}

type [Text Note] extends Annotation {
  doc "Free text placed on the canvas."
}

type [Sticky Note] extends Annotation {
  doc "A sticky note on the canvas."
}

type Comment extends Annotation {
  doc "A review comment on the canvas."
}

abstract type Group {
  kind other
  doc "A box drawn around components that belong together."
}

type [Logical Group] extends Group {
  doc "A box around components that form one part of the design."
}

type [Network Boundary] extends Group {
  doc "A box around components in one network, such as a VPC or a subnet."
}

type [Security Zone] extends Group {
  doc "A box around components that share one trust level."
}

type [Service Group] extends Group {
  doc "A box around the components one team or service owns."
}
` },
  { path: "stdlib/cloud-aws.proschi", source: '# Proschi standard library: Amazon Web Services. The rules are in core.proschi.\n\n# Edge\n\ntype [AWS CloudFront] extends CDN {\n  op forward MESSAGE # a WebSocket frame, read or written by whoever handles it\n  op write CreateInvalidation\n  doc "Amazon CloudFront, the CDN of AWS."\n}\n\ntype [AWS Route53] extends DNS {\n  op write ChangeResourceRecordSets\n  doc "Amazon Route 53, the DNS service of AWS, with health checks and latency routing."\n}\n\ntype [AWS Load Balancer] extends [Load Balancer] {\n  op forward MESSAGE # a WebSocket frame, read or written by whoever handles it\n  doc "Elastic Load Balancing: an application (L7) or network (L4) load balancer on AWS."\n}\n\ntype [AWS API Gateway] extends [API Gateway] {\n  doc "Amazon API Gateway, the managed API front door of AWS."\n}\n\ntype [AWS WAF] extends WAF {\n  doc "AWS WAF, the web application firewall in front of CloudFront, load balancers and API Gateway."\n}\n\ntype [AWS Global Accelerator] extends Edge {\n  doc "AWS Global Accelerator: anycast addresses that carry traffic over the AWS network to the nearest healthy region."\n}\n\n# Compute\n\ntype [AWS EC2] extends VM {\n  doc "Amazon EC2, virtual machines on AWS."\n}\n\ntype [AWS ECS] extends Docker {\n  doc "Amazon ECS, which runs containers on AWS."\n}\n\ntype [AWS Fargate] extends Docker {\n  doc "AWS Fargate, containers on AWS without servers to manage."\n}\n\ntype [AWS EKS] extends Kubernetes {\n  doc "Amazon EKS, managed Kubernetes on AWS."\n}\n\ntype [AWS Lambda] extends Function {\n  doc "AWS Lambda, functions that run per request or event on AWS."\n}\n\n# Data\n\ntype [AWS RDS] extends Database {\n  doc "Amazon RDS, managed relational databases on AWS (PostgreSQL, MySQL and others)."\n}\n\ntype [AWS Aurora] extends Database {\n  doc "Amazon Aurora, the AWS relational database compatible with PostgreSQL and MySQL, on shared distributed storage."\n}\n\ntype [AWS DynamoDB] extends DynamoDB {\n  doc "Amazon DynamoDB, the managed key-value and document database of AWS."\n}\n\ntype [AWS DocumentDB] extends MongoDB {\n  doc "Amazon DocumentDB, the AWS document database compatible with MongoDB."\n}\n\ntype [AWS Keyspaces] extends Cassandra {\n  doc "Amazon Keyspaces, the AWS wide-column database compatible with Cassandra."\n}\n\ntype [AWS Neptune] extends [Graph NoSQL Database] {\n  doc "Amazon Neptune, the graph database of AWS."\n}\n\ntype [AWS ElastiCache] extends Redis {\n  doc "Amazon ElastiCache, managed Redis, Valkey or Memcached on AWS."\n}\n\ntype [AWS OpenSearch] extends OpenSearch {\n  doc "Amazon OpenSearch Service, managed OpenSearch on AWS."\n}\n\ntype [AWS Redshift] extends [Data Warehouse] {\n  doc "Amazon Redshift, the data warehouse of AWS."\n}\n\ntype [AWS Athena] extends [Data Warehouse] {\n  op read  StartQueryExecution, GetQueryExecution, GetQueryResults\n  doc "Amazon Athena, SQL queries over files in S3."\n}\n\ntype [AWS S3] extends [Object Storage] {\n  op read  GetObject, HeadObject, ListObjectsV2, ListObjects, GetObjectTagging, GetObjectAcl\n  op read  ListMultipartUploads, ListParts, SelectObjectContent, HeadBucket, ListBuckets\n  op write PutObject, CopyObject, DeleteObject, DeleteObjects, RestoreObject, PutObjectTagging, PutObjectAcl\n  op write CreateMultipartUpload, UploadPart, UploadPartCopy, CompleteMultipartUpload, AbortMultipartUpload\n  op write CreateBucket, DeleteBucket\n  doc "Amazon S3, the object storage of AWS."\n}\n\ntype [AWS EBS] extends [Block Storage] {\n  doc "Amazon EBS, block volumes for EC2 instances."\n}\n\ntype [AWS EFS] extends [Shared File System] {\n  doc "Amazon EFS, a shared NFS file system on AWS."\n}\n\n# Messaging\n\ntype [AWS SQS] extends SQS {\n  doc "Amazon SQS, the managed message queue of AWS."\n}\n\ntype [AWS SNS] extends [Message Broker] {\n  op write PublishBatch, CreateTopic, DeleteTopic\n  doc "Amazon SNS, the pub/sub topics of AWS that fan out to queues, functions and phones."\n}\n\ntype [AWS EventBridge] extends [Message Broker] {\n  op write PutEvents, PutRule, PutTargets\n  doc "Amazon EventBridge, the AWS event bus that routes events by rules."\n}\n\ntype [AWS Kinesis] extends [Message Broker] {\n  op read  GetRecords, GetShardIterator, SubscribeToShard, DescribeStream, ListShards\n  op write PutRecord, PutRecords\n  doc "Amazon Kinesis Data Streams, the partitioned stream of AWS."\n}\n\ntype [AWS MSK] extends Kafka {\n  doc "Amazon MSK, managed Kafka on AWS."\n}\n\n# External\n\ntype [AWS SES] extends [Email Service] {\n  op write SendEmail, SendRawEmail, SendBulkEmail\n  doc "Amazon SES, the email sending service of AWS."\n}\n\ntype [AWS Cognito] extends [Auth Service] {\n  op read  GetUser\n  op write InitiateAuth, RespondToAuthChallenge, SignUp, ConfirmSignUp, GlobalSignOut\n  doc "Amazon Cognito, user sign-up and sign-in on AWS."\n}\n' },
  { path: "stdlib/cloud-azure.proschi", source: `# Proschi standard library: Microsoft Azure. The rules are in core.proschi.

# Edge

type [Azure CDN] extends CDN {
  doc "Azure CDN, the content delivery network of Azure."
}

type [Azure Front Door] extends CDN {
  op forward MESSAGE # a WebSocket frame, read or written by whoever handles it
  doc "Azure Front Door, Azure's global entry point: CDN, load balancing and WAF at the edge."
}

type [Azure DNS] extends DNS {
  doc "Azure DNS, the DNS service of Azure."
}

type [Azure Load Balancer] extends [Load Balancer] {
  doc "Azure Load Balancer, the L4 load balancer of Azure."
}

type [Azure Application Gateway] extends [Load Balancer] {
  op forward MESSAGE # a WebSocket frame, read or written by whoever handles it
  doc "Azure Application Gateway, the L7 load balancer of Azure, with an optional WAF."
}

type [Azure API Management] extends [API Gateway] {
  doc "Azure API Management, the API gateway and developer portal of Azure."
}

# Compute

type [Azure VM] extends VM {
  doc "Azure Virtual Machines, virtual machines on Azure."
}

type [Azure AKS] extends Kubernetes {
  doc "Azure Kubernetes Service, managed Kubernetes on Azure."
}

type [Azure Container Instances] extends Docker {
  doc "Azure Container Instances, containers on Azure without servers to manage."
}

type [Azure App Service] extends Platform {
  doc "Azure App Service, Azure's managed platform for web apps and APIs."
}

type [Azure Functions] extends Function {
  doc "Azure Functions, functions that run per request or event on Azure."
}

type [Azure Logic Apps] extends Function {
  doc "Azure Logic Apps, workflows of connectors that run on triggers."
}

# Data

type [Azure SQL] extends [SQL Server] {
  doc "Azure SQL Database, managed SQL Server on Azure."
}

type [Azure Database for PostgreSQL] extends PostgreSQL {
  doc "Azure Database for PostgreSQL, managed PostgreSQL on Azure."
}

type [Azure Database for MySQL] extends MySQL {
  doc "Azure Database for MySQL, managed MySQL on Azure."
}

type [Azure Cosmos DB] extends [Document NoSQL Database] {
  op read  ReadItem, ReadMany, QueryItems, ReadChangeFeed
  op write CreateItem, UpsertItem, ReplaceItem, PatchItem, DeleteItem, TransactionalBatch
  doc "Azure Cosmos DB, Azure's globally distributed multi-model database."
}

type [Azure Cache for Redis] extends Redis {
  doc "Azure Cache for Redis, managed Redis on Azure."
}

type [Azure AI Search] extends [Search Engine] {
  doc "Azure AI Search, the managed search service of Azure, with vector search."
}

type [Azure Blob Storage] extends [Object Storage] {
  op read  GetBlob, GetBlobProperties, GetBlobMetadata, GetBlockList, ListBlobs, ListContainers
  op write PutBlob, PutBlock, PutBlockList, PutPage, AppendBlock, CopyBlob, DeleteBlob
  op write SetBlobMetadata, SetBlobProperties, SnapshotBlob, LeaseBlob, CreateContainer, DeleteContainer
  doc "Azure Blob Storage, the object storage of Azure."
}

type [Azure Files] extends [Shared File System] {
  doc "Azure Files, managed SMB and NFS file shares on Azure."
}

type [Azure Disk Storage] extends [Block Storage] {
  doc "Azure Managed Disks, block volumes for Azure virtual machines."
}

# Messaging

type [Azure Queue Storage] extends [Message Queue] {
  op read  GetMessages, PeekMessages
  op write PutMessage, UpdateMessage, DeleteMessage, ClearMessages
  doc "Azure Queue Storage, simple message queues in an Azure storage account."
}

type [Azure Service Bus] extends [Message Broker] {
  op read  ReceiveMessages, PeekMessages
  op write SendMessages, CompleteMessage, AbandonMessage, DeadLetterMessage, DeferMessage, ScheduleMessages
  doc "Azure Service Bus, Azure's enterprise broker of queues and topics."
}

type [Azure Event Hubs] extends [Message Broker] {
  op read  ReceiveEvents
  op write SendEvents, UpdateCheckpoint
  doc "Azure Event Hubs, Azure's partitioned event stream, with a Kafka endpoint."
}

type [Azure Event Grid] extends [Message Broker] {
  op write PublishEvents
  doc "Azure Event Grid, Azure's event routing service."
}
` },
  { path: "stdlib/cloud-cloudflare.proschi", source: `# Proschi standard library: Cloudflare. The rules are in core.proschi.

type Cloudflare extends CDN {
  op forward MESSAGE # a WebSocket frame, read or written by whoever handles it
  doc "Cloudflare, the CDN and edge network in front of the origin."
}

type [Cloudflare Workers] extends Function {
  doc "Cloudflare Workers, functions that run at Cloudflare's edge locations."
}

type [Cloudflare R2] extends [AWS S3] {
  doc "Cloudflare R2, object storage with the S3 API and no egress fees."
}
` },
  { path: "stdlib/cloud-gcp.proschi", source: `# Proschi standard library: Google Cloud. The rules are in core.proschi.

# Edge

type [GCP Cloud CDN] extends CDN {
  doc "Cloud CDN, the CDN of Google Cloud."
}

type [GCP Cloud DNS] extends DNS {
  doc "Cloud DNS, the DNS service of Google Cloud."
}

type [GCP Load Balancing] extends [Load Balancer] {
  op forward MESSAGE # a WebSocket frame, read or written by whoever handles it
  doc "Cloud Load Balancing, Google Cloud's global and regional load balancers."
}

type [GCP Apigee] extends [API Gateway] {
  doc "Apigee, Google Cloud's API management platform."
}

# Compute

type [GCP Compute Engine] extends VM {
  doc "Compute Engine, virtual machines on Google Cloud."
}

type [GCP GKE] extends Kubernetes {
  doc "Google Kubernetes Engine, managed Kubernetes on Google Cloud."
}

type [GCP Cloud Functions] extends Function {
  doc "Cloud Functions, functions that run per request or event on Google Cloud."
}

type [GCP Cloud Run] extends Function {
  doc "Cloud Run, containers that run per request and scale to zero on Google Cloud."
}

type [GCP App Engine] extends Function {
  doc "App Engine, Google Cloud's managed platform for web apps."
}

# Data

type [GCP Cloud SQL] extends Database {
  doc "Cloud SQL, managed PostgreSQL, MySQL and SQL Server on Google Cloud."
}

type [GCP Spanner] extends [Distributed SQL Database] {
  op read  ExecuteSql, ExecuteStreamingSql, StreamingRead, BeginTransaction
  op write ExecuteBatchDml
  doc "Spanner, Google Cloud's globally distributed relational database with external consistency."
}

type [GCP Firestore] extends [Document NoSQL Database] {
  op read  GetDocument, ListDocuments, BatchGetDocuments, RunQuery, RunAggregationQuery, Listen
  op write CreateDocument, UpdateDocument, DeleteDocument, BatchWrite, Commit, BeginTransaction
  doc "Firestore, Google Cloud's serverless document database."
}

type [GCP Bigtable] extends [Wide-Column NoSQL Database] {
  op read  ReadRows, SampleRowKeys
  op write MutateRow, MutateRows, CheckAndMutateRow, ReadModifyWriteRow
  doc "Bigtable, Google Cloud's wide-column database for large, low-latency workloads."
}

type [GCP Memorystore] extends Redis {
  doc "Memorystore, managed Redis and Memcached on Google Cloud."
}

type [GCP BigQuery] extends [Data Warehouse] {
  doc "BigQuery, Google Cloud's serverless data warehouse."
}

type [GCP Cloud Storage] extends [Object Storage] {
  op write Insert, Patch, Update, Copy, Compose, Rewrite
  doc "Cloud Storage, the object storage of Google Cloud."
}

type [GCP Persistent Disk] extends [Block Storage] {
  doc "Persistent Disk, block volumes for Compute Engine."
}

# Messaging

type [GCP Pub/Sub] extends [Message Broker] {
  op read  Pull, StreamingPull
  op write Acknowledge, ModifyAckDeadline, CreateTopic, CreateSubscription, Seek
  doc "Pub/Sub, Google Cloud's global messaging service of topics and subscriptions."
}
` },
  { path: "stdlib/compute.proschi", source: '# Proschi standard library: compute, the code you run. The rules are in\n# core.proschi.\n\nabstract type Compute {\n  kind service\n  protocol HTTP\n  status 100, 101, 102, 103\n  status 200, 201, 202, 203, 204, 205, 206, 207, 208, 226\n  status 300, 301, 302, 303, 304, 307, 308\n  status 400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418\n  status 421, 422, 423, 424, 425, 426, 428, 429, 431, 451\n  status 500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511\n  header Accept, Accept-Encoding, Accept-Language, Accept-Ranges, Age, Allow, Authorization\n  header Cache-Control, Connection, Content-Disposition, Content-Encoding, Content-Language\n  header Content-Length, Content-Range, Content-Type, Cookie, Date, ETag, Expires, Host\n  header If-Match, If-Modified-Since, If-None-Match, If-Range, If-Unmodified-Since, Last-Modified\n  header Link, Location, Origin, Range, Referer, Retry-After, Server, Set-Cookie, User-Agent, Vary\n  header Upgrade, WWW-Authenticate, Proxy-Authorization, Strict-Transport-Security, Content-Security-Policy\n  header Access-Control-Allow-Origin, Access-Control-Allow-Methods, Access-Control-Allow-Headers\n  header Access-Control-Allow-Credentials, Access-Control-Max-Age, Access-Control-Request-Method\n  header Forwarded, X-Forwarded-For, X-Forwarded-Host, X-Forwarded-Proto, X-Real-IP\n  header X-Request-Id, X-Correlation-Id, Traceparent, Tracestate, Idempotency-Key\n  header X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset\n  header X-API-Key, X-Content-Type-Options, X-Frame-Options, Sec-WebSocket-Key, Sec-WebSocket-Accept, Sec-WebSocket-Protocol\n  doc "Code you run: a service, a worker, a function or the platform it runs on; its own requests are named freely."\n}\n\ntype Service extends Compute {\n  doc "A program you run that answers requests, whatever it is written in."\n}\n\ntype Worker extends Compute {\n  doc "A background program that takes jobs or events from a queue and processes them."\n}\n\n# Interfaces.\n\nabstract type [HTTP Service] extends Service {\n  op read  GET, HEAD, OPTIONS, TRACE, CONNECT\n  op write POST, PUT, PATCH, DELETE\n  doc "A service whose requests are HTTP methods: GET, HEAD and OPTIONS read, POST, PUT, PATCH and DELETE write."\n}\n\ntype [REST API] extends [HTTP Service] {\n  doc "A service with a REST interface: resources over HTTP methods and status codes."\n}\n\ntype GraphQL extends [HTTP Service] {\n  protocol GraphQL\n  op read  query, subscription\n  op write mutation\n  doc "A service with a GraphQL interface: queries read, mutations write."\n}\n\ntype gRPC extends Service {\n  protocol gRPC\n  doc "A service with a gRPC interface: typed calls over HTTP/2, named by its own .proto file."\n}\n\ntype WebSocket extends Service {\n  protocol WebSocket\n  doc "A service that keeps a WebSocket open to each client and pushes messages both ways, named freely."\n}\n\ntype [SOAP API] extends Service {\n  protocol SOAP\n  doc "A service with a SOAP interface: XML messages over HTTP."\n}\n\n# Languages and frameworks: a service written in it.\n\ntype Java extends Service {\n  doc "A service on the JVM, written in Java."\n}\n\ntype [Spring Boot] extends Java {\n  doc "A service built with Spring Boot."\n}\n\ntype Kotlin extends Service {\n  doc "A service written in Kotlin."\n}\n\ntype Go extends Service {\n  doc "A service written in Go."\n}\n\ntype [Node.js] extends Service {\n  doc "A service on Node.js, written in JavaScript or TypeScript."\n}\n\ntype Python extends Service {\n  doc "A service written in Python."\n}\n\ntype Django extends Python {\n  doc "A service built with Django."\n}\n\ntype FastAPI extends Python {\n  doc "A service built with FastAPI."\n}\n\ntype Flask extends Python {\n  doc "A service built with Flask."\n}\n\ntype [Ruby on Rails] extends Service {\n  doc "A service built with Ruby on Rails."\n}\n\ntype [.NET] extends Service {\n  doc "A service on .NET, written in C#."\n}\n\ntype PHP extends Service {\n  doc "A service written in PHP."\n}\n\ntype Rust extends Service {\n  doc "A service written in Rust."\n}\n\ntype Elixir extends Service {\n  doc "A service written in Elixir, on the Erlang VM."\n}\n\n# Where services run.\n\nabstract type Platform extends Compute {\n  doc "Where a service runs, drawn as the platform: it answers like the service on it."\n}\n\ntype VM extends Platform {\n  doc "A virtual machine running the service."\n}\n\ntype Docker extends Platform {\n  doc "A container running the service."\n}\n\ntype Kubernetes extends Platform {\n  doc "Pods on a Kubernetes cluster running the service."\n}\n\n# Functions.\n\ntype Function extends Compute {\n  kind function\n  doc "A serverless function: runs per request or event and scales to zero."\n}\n' },
  { path: "stdlib/data.proschi", source: '# Proschi standard library: components that keep data. Queues and brokers\n# are in messaging.proschi. The rules are in core.proschi.\n\nabstract type Data {\n  op read  READ, FETCH, LOOKUP\n  op write WRITE, SAVE, STORE, RECORD, MARK, RESERVE, HOLD, BOOK\n  doc "A component that keeps data: a database, cache, search index, warehouse or bucket."\n}\n\n# Relational databases.\n\ntype Database extends Data {\n  kind database\n  protocol SQL\n  op read  SELECT, WITH, EXPLAIN, SHOW, BEGIN, ROLLBACK\n  op write INSERT, UPDATE, DELETE, UPSERT, MERGE, TRUNCATE, COMMIT, LOCK\n  op write CREATE, ALTER, DROP\n  doc "A relational database queried with SQL, whose product does not matter."\n}\n\ntype PostgreSQL extends Database {\n  op read  LISTEN\n  op write NOTIFY, COPY, VACUUM\n  doc "PostgreSQL, the open source relational database."\n}\n\ntype MySQL extends Database {\n  op write REPLACE\n  doc "MySQL, the open source relational database."\n}\n\ntype MariaDB extends MySQL {\n  doc "MariaDB, the community fork of MySQL."\n}\n\ntype SQLite extends Database {\n  doc "SQLite, the embedded relational database in a single file."\n}\n\ntype Oracle extends Database {\n  doc "Oracle Database, the commercial relational database."\n}\n\ntype [SQL Server] extends Database {\n  doc "Microsoft SQL Server, the commercial relational database."\n}\n\ntype TimescaleDB extends PostgreSQL {\n  kind analytics\n  doc "TimescaleDB, PostgreSQL extended for time series."\n}\n\nabstract type [Distributed SQL Database] extends Database {\n  doc "A relational database that shards and replicates itself across nodes, keeping transactions."\n}\n\ntype CockroachDB extends [Distributed SQL Database] {\n  doc "CockroachDB, a distributed SQL database that speaks the PostgreSQL protocol."\n}\n\ntype YugabyteDB extends [Distributed SQL Database] {\n  doc "YugabyteDB, a distributed SQL database compatible with PostgreSQL."\n}\n\ntype TiDB extends [Distributed SQL Database] {\n  doc "TiDB, a distributed SQL database compatible with MySQL."\n}\n\ntype Vitess extends [Distributed SQL Database] {\n  doc "Vitess, which shards MySQL behind one SQL endpoint."\n}\n\n# NoSQL databases.\n\ntype [NoSQL Database] extends Data {\n  kind database\n  op read  GET\n  op write PUT, SET, DELETE\n  doc "A non-relational database that partitions data by key, whose product does not matter."\n}\n\ntype DynamoDB extends [NoSQL Database] {\n  op read  GetItem, BatchGetItem, Query, TransactGetItems, DescribeTable\n  op read  Scan latency 10 cost 25\n  op write PutItem, UpdateItem, DeleteItem, BatchWriteItem, TransactWriteItems\n  op write ExecuteStatement, CreateTable, UpdateTable, DeleteTable\n  doc "DynamoDB, the managed key-value and document database: reads by key or partition, a Scan reads the whole table."\n}\n\nabstract type [Document NoSQL Database] extends [NoSQL Database] {\n  doc "A NoSQL database that stores JSON-like documents and queries their fields."\n}\n\ntype MongoDB extends [Document NoSQL Database] {\n  op read  find, findOne, aggregate, countDocuments, estimatedDocumentCount, distinct, watch\n  op write insertOne, insertMany, updateOne, updateMany, replaceOne, deleteOne, deleteMany\n  op write findOneAndUpdate, findOneAndReplace, findOneAndDelete, bulkWrite, createIndex\n  doc "MongoDB, the document database."\n}\n\ntype CouchDB extends [Document NoSQL Database] {\n  doc "Apache CouchDB, a document database with an HTTP API and multi-primary replication."\n}\n\ntype Couchbase extends [Document NoSQL Database] {\n  op read  lookupIn, exists, query\n  op write upsert, insert, replace, remove, mutateIn, touch, increment, decrement\n  doc "Couchbase, a document database with a built-in cache."\n}\n\nabstract type [Wide-Column NoSQL Database] extends [NoSQL Database] {\n  doc "A NoSQL database of rows with many columns, partitioned by key and sorted within a partition."\n}\n\ntype Cassandra extends [Wide-Column NoSQL Database] {\n  protocol CQL\n  op read  SELECT\n  op write INSERT, UPDATE, DELETE, BATCH, TRUNCATE\n  doc "Apache Cassandra, the wide-column database queried with CQL."\n}\n\ntype ScyllaDB extends Cassandra {\n  doc "ScyllaDB, a Cassandra-compatible database written in C++."\n}\n\ntype HBase extends [Wide-Column NoSQL Database] {\n  op read  Exists\n  op read  Scan latency 10 cost 25\n  op write Increment, Append, CheckAndMutate\n  doc "Apache HBase, the wide-column database on HDFS."\n}\n\nabstract type [Graph NoSQL Database] extends [NoSQL Database] {\n  protocol Cypher\n  op read  MATCH, OPTIONAL, RETURN, CALL\n  op write CREATE, MERGE, DELETE, DETACH, SET, REMOVE\n  doc "A graph database: nodes and relationships, queried by pattern."\n}\n\ntype Neo4j extends [Graph NoSQL Database] {\n  doc "Neo4j, the graph database queried with Cypher."\n}\n\nabstract type [Coordination Store] extends Data {\n  kind database\n  doc "A small, strongly consistent store for configuration, leader election and locks."\n}\n\ntype etcd extends [Coordination Store] {\n  op read  Range, Watch, LeaseTimeToLive\n  op write Put, DeleteRange, Txn, Compact, LeaseGrant, LeaseRevoke, LeaseKeepAlive\n  doc "etcd, the consistent key-value store behind Kubernetes."\n}\n\ntype ZooKeeper extends [Coordination Store] {\n  op read  getData, getChildren, exists, getACL, sync\n  op write create, setData, delete, setACL, multi\n  doc "Apache ZooKeeper, the coordination service of znodes and watches."\n}\n\n# Caches.\n\ntype Cache extends Data {\n  kind cache\n  op read  GET, MGET\n  op write SET, DELETE, EXPIRE\n  doc "An in-memory key-value cache, whose product does not matter."\n}\n\ntype Redis extends Cache {\n  protocol RESP\n  # Strings\n  op read  GETRANGE, STRLEN\n  op write SETNX, SETEX, PSETEX, GETSET, GETDEL, GETEX, MSET, MSETNX, APPEND, SETRANGE\n  op write INCR, INCRBY, INCRBYFLOAT, DECR, DECRBY\n  # Keys\n  op read  EXISTS, TTL, PTTL, TYPE, KEYS, SCAN\n  op write DEL, UNLINK, PEXPIRE, EXPIREAT, PEXPIREAT, PERSIST, RENAME, COPY\n  # Hashes\n  op read  HGET, HMGET, HGETALL, HEXISTS, HKEYS, HVALS, HLEN, HSCAN\n  op write HSET, HSETNX, HMSET, HDEL, HINCRBY, HINCRBYFLOAT\n  # Lists\n  op read  LRANGE, LLEN, LINDEX\n  op write LPUSH, RPUSH, LPUSHX, RPUSHX, LPOP, RPOP, BLPOP, BRPOP, LSET, LREM, LTRIM, LINSERT, LMOVE, BLMOVE\n  # Sets\n  op read  SMEMBERS, SISMEMBER, SMISMEMBER, SCARD, SRANDMEMBER, SINTER, SUNION, SDIFF, SSCAN\n  op write SADD, SREM, SPOP, SMOVE, SINTERSTORE, SUNIONSTORE, SDIFFSTORE\n  # Sorted sets\n  op read  ZRANGE, ZREVRANGE, ZRANGEBYSCORE, ZREVRANGEBYSCORE, ZRANGEBYLEX, ZSCORE, ZMSCORE\n  op read  ZRANK, ZREVRANK, ZCARD, ZCOUNT, ZSCAN\n  op write ZADD, ZREM, ZINCRBY, ZPOPMIN, ZPOPMAX, BZPOPMIN, BZPOPMAX, ZREMRANGEBYSCORE, ZREMRANGEBYRANK\n  op write ZUNIONSTORE, ZINTERSTORE, ZRANGESTORE\n  # Bitmaps and HyperLogLog\n  op read  GETBIT, BITCOUNT, BITPOS, PFCOUNT\n  op write SETBIT, BITOP, PFADD, PFMERGE\n  # Geo\n  op read  GEOSEARCH, GEODIST, GEOPOS, GEOHASH, GEORADIUS, GEORADIUSBYMEMBER\n  op write GEOADD, GEOSEARCHSTORE\n  # Pub/sub\n  op read  SUBSCRIBE, PSUBSCRIBE, UNSUBSCRIBE, PUNSUBSCRIBE, SSUBSCRIBE\n  op write PUBLISH, SPUBLISH\n  # Streams\n  op read  XREAD, XREADGROUP, XRANGE, XREVRANGE, XLEN, XPENDING, XINFO\n  op write XADD, XACK, XCLAIM, XAUTOCLAIM, XDEL, XTRIM, XGROUP\n  # Transactions and scripts\n  op read  MULTI, WATCH, UNWATCH, DISCARD, PING\n  op write EXEC, EVAL, EVALSHA, FCALL\n  doc "Redis, the in-memory data store, used as a cache."\n}\n\ntype Valkey extends Redis {\n  doc "Valkey, the open source fork of Redis."\n}\n\ntype KeyDB extends Redis {\n  doc "KeyDB, a multithreaded fork of Redis."\n}\n\ntype Dragonfly extends Redis {\n  doc "Dragonfly, an in-memory store compatible with Redis."\n}\n\ntype Memcached extends Cache {\n  op read  GETS\n  op write ADD, REPLACE, APPEND, PREPEND, CAS, INCR, DECR, TOUCH, GAT, GATS, FLUSH_ALL\n  doc "Memcached, the simple distributed in-memory cache."\n}\n\ntype Hazelcast extends Cache {\n  doc "Hazelcast, the in-memory data grid."\n}\n\ntype Aerospike extends Cache {\n  doc "Aerospike, the key-value store tuned for memory and flash."\n}\n\n# Search.\n\ntype [Search Engine] extends Data {\n  kind search\n  op read  Search, KNN\n  op write Index, Upsert, Delete\n  doc "A full-text search index, whose product does not matter."\n}\n\ntype Elasticsearch extends [Search Engine] {\n  op read  Get, Mget, Count, MultiSearch, Scroll, Explain, _search, _msearch, _count\n  op write Bulk, Update, Create, UpdateByQuery, DeleteByQuery, Reindex, Refresh, _bulk, _doc, _update\n  doc "Elasticsearch, the distributed search engine on Lucene."\n}\n\ntype OpenSearch extends Elasticsearch {\n  doc "OpenSearch, the open source fork of Elasticsearch."\n}\n\ntype Solr extends [Search Engine] {\n  doc "Apache Solr, the search server on Lucene."\n}\n\ntype Meilisearch extends [Search Engine] {\n  doc "Meilisearch, a fast search engine for search-as-you-type."\n}\n\ntype Typesense extends [Search Engine] {\n  doc "Typesense, an in-memory search engine that tolerates typos."\n}\n\ntype Algolia extends [Search Engine] {\n  doc "Algolia, the hosted search API."\n}\n\n# Analytics.\n\ntype [Data Warehouse] extends Data {\n  kind analytics\n  protocol SQL\n  op read  SELECT, WITH, EXPLAIN, SHOW\n  op write INSERT, UPDATE, DELETE, UPSERT, MERGE, COPY, TRUNCATE, CREATE, DROP\n  doc "A column store for analytical SQL over large data, whose product does not matter."\n}\n\ntype Snowflake extends [Data Warehouse] {\n  doc "Snowflake, the cloud data warehouse."\n}\n\ntype ClickHouse extends [Data Warehouse] {\n  doc "ClickHouse, the column-oriented OLAP database."\n}\n\ntype [Apache Druid] extends [Data Warehouse] {\n  doc "Apache Druid, the real-time analytics database."\n}\n\ntype [Apache Pinot] extends [Data Warehouse] {\n  doc "Apache Pinot, the real-time OLAP store for user-facing analytics."\n}\n\ntype Databricks extends [Data Warehouse] {\n  doc "Databricks, the lakehouse platform on Spark."\n}\n\nabstract type [Time Series Store] extends Data {\n  kind analytics\n  op read  QUERY, SELECT\n  op write INSERT\n  doc "A database of timestamped measurements, queried over time ranges."\n}\n\ntype InfluxDB extends [Time Series Store] {\n  doc "InfluxDB, the time series database."\n}\n\ntype Prometheus extends [Time Series Store] {\n  doc "Prometheus, the monitoring system and its time series store."\n}\n\n# Files and objects.\n\ntype [Object Storage] extends Data {\n  kind storage\n  protocol HTTP\n  op read  GET, HEAD, LIST\n  op write PUT, DELETE, UPLOAD\n  doc "A bucket of objects (files) by key, whose product does not matter."\n}\n\ntype MinIO extends [AWS S3] {\n  doc "MinIO, the self-hosted object storage with the S3 API."\n}\n\ntype Ceph extends [Object Storage] {\n  doc "Ceph, the distributed object, block and file storage."\n}\n\nabstract type [Shared File System] extends Data {\n  kind storage\n  op read  OPEN, LIST\n  op write APPEND\n  doc "A file system many machines mount at once."\n}\n\ntype HDFS extends [Shared File System] {\n  doc "HDFS, the Hadoop distributed file system."\n}\n\nabstract type [Block Storage] extends Data {\n  kind storage\n  doc "A disk attached to one machine."\n}\n' },
  { path: "stdlib/edge.proschi", source: `# Proschi standard library: the edge, between the clients and the services.
# The rules are in core.proschi.

abstract type Edge {
  kind edge
  doc "What a request passes through before it reaches a service: DNS, a CDN, a load balancer or a gateway."
}

abstract type [HTTP Edge] extends Edge {
  protocol HTTP
  op read  GET, HEAD, OPTIONS, TRACE, CONNECT
  op write POST, PUT, PATCH, DELETE
  status 100, 101, 102, 103
  status 200, 201, 202, 203, 204, 205, 206, 207, 208, 226
  status 300, 301, 302, 303, 304, 307, 308
  status 400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418
  status 421, 422, 423, 424, 425, 426, 428, 429, 431, 451
  status 500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511
  header Accept, Accept-Encoding, Accept-Language, Accept-Ranges, Age, Allow, Authorization
  header Cache-Control, Connection, Content-Disposition, Content-Encoding, Content-Language
  header Content-Length, Content-Range, Content-Type, Cookie, Date, ETag, Expires, Host
  header If-Match, If-Modified-Since, If-None-Match, If-Range, If-Unmodified-Since, Last-Modified
  header Link, Location, Origin, Range, Referer, Retry-After, Server, Set-Cookie, User-Agent, Vary
  header Upgrade, WWW-Authenticate, Proxy-Authorization, Strict-Transport-Security, Content-Security-Policy
  header Access-Control-Allow-Origin, Access-Control-Allow-Methods, Access-Control-Allow-Headers
  header Access-Control-Allow-Credentials, Access-Control-Max-Age, Access-Control-Request-Method
  header Forwarded, X-Forwarded-For, X-Forwarded-Host, X-Forwarded-Proto, X-Real-IP
  header X-Request-Id, X-Correlation-Id, Traceparent, Tracestate, Idempotency-Key
  header X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
  header X-API-Key, X-Content-Type-Options, X-Frame-Options, Sec-WebSocket-Key, Sec-WebSocket-Accept, Sec-WebSocket-Protocol
  doc "An edge component that takes HTTP requests and passes them on."
}

type DNS extends Edge {
  kind dns
  protocol DNS
  op read  QUERY, RESOLVE
  op write UPDATE
  doc "A DNS service: turns a host name into the addresses to connect to."
}

type CDN extends [HTTP Edge] {
  kind cdn
  op write PURGE
  doc "A content delivery network: caches responses at edge locations near the users."
}

type [Load Balancer] extends [HTTP Edge] {
  kind loadbalancer
  doc "Spreads requests over the replicas behind it and stops sending to unhealthy ones."
}

type [API Gateway] extends [HTTP Edge] {
  op forward MESSAGE # a WebSocket frame, read or written by whoever handles it
  kind gateway
  doc "One entry point for an API: routing, authentication and rate limits before the services."
}

type WAF extends [HTTP Edge] {
  doc "A web application firewall: blocks malicious requests at the edge."
}

# Products.

type Fastly extends CDN {
  op forward MESSAGE # a WebSocket frame, read or written by whoever handles it
  doc "Fastly, the programmable CDN."
}

type Akamai extends CDN {
  op forward MESSAGE # a WebSocket frame, read or written by whoever handles it
  doc "Akamai, the CDN and edge security platform."
}

type nginx extends [Load Balancer] {
  op forward MESSAGE # a WebSocket frame, read or written by whoever handles it
  doc "nginx, the web server used as a reverse proxy and load balancer."
}

type Envoy extends [Load Balancer] {
  op forward MESSAGE # a WebSocket frame, read or written by whoever handles it
  doc "Envoy, the L7 proxy behind most service meshes."
}

type HAProxy extends [Load Balancer] {
  op forward MESSAGE # a WebSocket frame, read or written by whoever handles it
  doc "HAProxy, the TCP and HTTP load balancer."
}

type Traefik extends [Load Balancer] {
  op forward MESSAGE # a WebSocket frame, read or written by whoever handles it
  doc "Traefik, the reverse proxy that configures itself from containers."
}

type [Kubernetes Ingress] extends [Load Balancer] {
  op forward MESSAGE # a WebSocket frame, read or written by whoever handles it
  doc "A Kubernetes ingress controller: routes outside HTTP traffic to the cluster's services."
}

type Kong extends [API Gateway] {
  doc "Kong, the open source API gateway built on nginx."
}

type [Spring Cloud Gateway] extends [API Gateway] {
  doc "Spring Cloud Gateway, an API gateway for Spring services."
}
` },
  { path: "stdlib/external.proschi", source: `# Proschi standard library: systems you call but do not run. The rules are in
# core.proschi.

abstract type External {
  kind external
  protocol HTTP
  op read  GET, HEAD, OPTIONS, TRACE, CONNECT
  op write POST, PUT, PATCH, DELETE
  status 100, 101, 102, 103
  status 200, 201, 202, 203, 204, 205, 206, 207, 208, 226
  status 300, 301, 302, 303, 304, 307, 308
  status 400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418
  status 421, 422, 423, 424, 425, 426, 428, 429, 431, 451
  status 500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511
  header Accept, Accept-Encoding, Accept-Language, Accept-Ranges, Age, Allow, Authorization
  header Cache-Control, Connection, Content-Disposition, Content-Encoding, Content-Language
  header Content-Length, Content-Range, Content-Type, Cookie, Date, ETag, Expires, Host
  header If-Match, If-Modified-Since, If-None-Match, If-Range, If-Unmodified-Since, Last-Modified
  header Link, Location, Origin, Range, Referer, Retry-After, Server, Set-Cookie, User-Agent, Vary
  header Upgrade, WWW-Authenticate, Proxy-Authorization, Strict-Transport-Security, Content-Security-Policy
  header Access-Control-Allow-Origin, Access-Control-Allow-Methods, Access-Control-Allow-Headers
  header Access-Control-Allow-Credentials, Access-Control-Max-Age, Access-Control-Request-Method
  header Forwarded, X-Forwarded-For, X-Forwarded-Host, X-Forwarded-Proto, X-Real-IP
  header X-Request-Id, X-Correlation-Id, Traceparent, Tracestate, Idempotency-Key
  header X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
  header X-API-Key, X-Content-Type-Options, X-Frame-Options, Sec-WebSocket-Key, Sec-WebSocket-Accept, Sec-WebSocket-Protocol
  doc "A system run by someone else that the design calls over its API."
}

type [Third Party API] extends External {
  op write SEND, NOTIFY
  doc "Another company's API, whose product does not matter."
}

type [Payment Gateway] extends External {
  op read  RETRIEVE
  op write CHARGE, AUTHORIZE, CAPTURE, REFUND, VOID, PAYOUT
  doc "A payment provider: authorizes, captures and refunds card payments."
}

type Stripe extends [Payment Gateway] {
  doc "Stripe, the payments API."
}

type PayPal extends [Payment Gateway] {
  doc "PayPal, the online payments service."
}

type Adyen extends [Payment Gateway] {
  doc "Adyen, the payments platform for cards and local payment methods."
}

type Braintree extends [Payment Gateway] {
  doc "Braintree, PayPal's payments API for cards and wallets."
}

type [Auth Service] extends External {
  op read  VALIDATE, VERIFY, INTROSPECT, USERINFO, JWKS
  op write LOGIN, LOGOUT, TOKEN, REFRESH, REVOKE, REGISTER
  doc "An identity provider: signs users in and issues and checks their tokens."
}

type Auth0 extends [Auth Service] {
  doc "Auth0, the hosted identity provider."
}

type Okta extends [Auth Service] {
  doc "Okta, the identity and single sign-on provider."
}

abstract type Notifier extends External {
  op write SEND, NOTIFY
  doc "A provider that delivers messages to people: email, SMS or push notifications."
}

type [Email Service] extends Notifier {
  doc "An email provider that sends the design's emails."
}

type SendGrid extends [Email Service] {
  doc "SendGrid, Twilio's email API."
}

type Mailgun extends [Email Service] {
  doc "Mailgun, the email API."
}

type [SMS Service] extends Notifier {
  doc "An SMS provider that sends text messages."
}

type Twilio extends [SMS Service] {
  doc "Twilio, the API for SMS, voice and messaging."
}

type [Push Service] extends Notifier {
  doc "A push notification provider that delivers to phones."
}

type APNs extends [Push Service] {
  doc "Apple Push Notification service, which delivers push notifications to Apple devices."
}

type FCM extends [Push Service] {
  doc "Firebase Cloud Messaging, which delivers push notifications to Android, iOS and the web."
}

type [Analytics Service] extends External {
  op write TRACK, IDENTIFY, PAGE, SCREEN, ALIAS
  doc "A product analytics provider that receives usage events."
}

type [Google Maps] extends External {
  op read  GEOCODE, DIRECTIONS, DISTANCE, PLACES, ROUTES, TILES
  doc "Google Maps Platform: geocoding, directions, distances and map tiles."
}

type OpenAI extends External {
  op read  COMPLETE, CHAT, EMBED, MODERATE, TRANSCRIBE
  doc "OpenAI's API for language models and embeddings."
}
` },
  { path: "stdlib/messaging.proschi", source: '# Proschi standard library: queues and brokers, which take a message and\n# hand it on later. The rules are in core.proschi.\n\nabstract type Messaging {\n  op read  RECEIVE, SUBSCRIBE, UNSUBSCRIBE, READ\n  op write SEND, PUBLISH, EMIT, ENQUEUE, WRITE, ACK, NACK\n  doc "A component that takes a message and hands it on later: a queue or a broker."\n}\n\ntype [Message Queue] extends Messaging {\n  kind queue\n  op read  DEQUEUE, PEEK, POLL\n  doc "A queue of jobs: each message goes to one consumer, which deletes it when done."\n}\n\ntype [Message Broker] extends Messaging {\n  kind broker\n  op read  CONSUME, FETCH\n  op write PRODUCE\n  doc "A broker of topics or streams: every subscriber gets each message, and the log can be replayed."\n}\n\ntype SQS extends [Message Queue] {\n  op read  ReceiveMessage, GetQueueAttributes, GetQueueUrl, ListQueues\n  op write SendMessage, SendMessageBatch, DeleteMessage, DeleteMessageBatch\n  op write ChangeMessageVisibility, ChangeMessageVisibilityBatch, PurgeQueue\n  op write CreateQueue, DeleteQueue, SetQueueAttributes\n  doc "SQS, the managed message queue of AWS."\n}\n\ntype [Redis Queue] extends [Message Queue] {\n  protocol RESP\n  op read  XREAD, XREADGROUP, XRANGE, XLEN, XPENDING, LRANGE, LLEN, PSUBSCRIBE\n  op write XADD, XACK, XCLAIM, XAUTOCLAIM, XDEL, XTRIM, XGROUP, LPUSH, RPUSH, LPOP, RPOP, BLPOP, BRPOP, LMOVE, BLMOVE\n  doc "A queue on Redis: a list, a stream or pub/sub channels."\n}\n\ntype ZeroMQ extends [Message Queue] {\n  op read  RECV\n  doc "ZeroMQ, the brokerless messaging library of sockets."\n}\n\ntype Kafka extends [Message Broker] {\n  op read  Poll, OffsetFetch, ListOffsets, Metadata\n  op write Commit, OffsetCommit, AddPartitionsToTxn, EndTxn, DeleteRecords\n  op write CreateTopics, DeleteTopics, CreatePartitions\n  doc "Apache Kafka, the distributed log of partitioned topics."\n}\n\ntype Redpanda extends Kafka {\n  doc "Redpanda, a Kafka-compatible streaming platform written in C++."\n}\n\ntype RabbitMQ extends [Message Broker] {\n  protocol AMQP\n  op read  BasicGet, BasicConsume\n  op write BasicPublish, BasicAck, BasicNack, BasicReject, QueueDeclare, ExchangeDeclare, QueueBind, QueuePurge\n  doc "RabbitMQ, the AMQP broker of exchanges and queues."\n}\n\ntype NATS extends [Message Broker] {\n  op read  REQUEST, SUB\n  op write PUB, REPLY\n  doc "NATS, the lightweight messaging system, with JetStream for persistence."\n}\n\ntype [Apache Pulsar] extends [Message Broker] {\n  doc "Apache Pulsar, the broker of topics with tiered storage."\n}\n\ntype ActiveMQ extends [Message Broker] {\n  doc "Apache ActiveMQ, the JMS message broker."\n}\n' }
];

// ../frontend/src/dsl/typesys/stdlib.ts
var cached;
function loadStdlib(read2) {
  if (!cached) {
    const files = STDLIB_SOURCES.map(({ source, path }) => read2(source, path));
    const resolution = resolveTypes(files.flatMap((f) => f.decls.map((d) => ({ ...d, builtin: true }))));
    cached = { ...resolution, diagnostics: [...files.flatMap((f) => f.diagnostics), ...resolution.diagnostics] };
  }
  return cached;
}

// ../frontend/src/dsl/typesys/ops.ts
function opNamesMostSpecificFirst(type, table) {
  const chain = [type, ...type.parents.flatMap((p) => table.get(typeKey(p)) ?? [])];
  const seen = /* @__PURE__ */ new Set();
  const names = [];
  chain.forEach((t, i) => {
    const parent = chain[i + 1];
    for (const op of t.ops) {
      const key = op.name.toLowerCase();
      if (seen.has(key) || parent?.ops.some((o) => o.name.toLowerCase() === key)) continue;
      seen.add(key);
      names.push(op.name);
    }
  });
  return names;
}
function findOp(type, text) {
  const t = text.trimStart().replace(/^"/, "").toLowerCase();
  let best;
  for (const op of type.ops) {
    const name = op.name.toLowerCase();
    if (!t.startsWith(name) || /[A-Za-z0-9_]/.test(t.charAt(name.length))) continue;
    if (!best || op.name.length > best.name.length) best = op;
  }
  return best;
}
function opWord(text) {
  return /^\s*"?([A-Za-z_][A-Za-z0-9_]*)/.exec(text)?.[1];
}
function suggestOp(type, word) {
  const w = word.toLowerCase();
  let best;
  let bestDistance = Math.max(1, Math.floor(w.length / 3)) + 1;
  for (const op of type.ops) {
    const d = editDistance(w, op.name.toLowerCase());
    if (d < bestDistance) [best, bestDistance] = [op.name, d];
  }
  return best;
}
function findHeader(type, name) {
  const n = name.toLowerCase();
  return type.headers.find((h2) => h2.toLowerCase() === n);
}
function suggestHeader(type, name) {
  const n = name.toLowerCase();
  let best;
  let bestDistance = Math.max(1, Math.floor(n.length / 3)) + 1;
  for (const h2 of type.headers) {
    const d = editDistance(n, h2.toLowerCase());
    if (d < bestDistance) [best, bestDistance] = [h2, d];
  }
  return best;
}

// ../frontend/src/dsl/parser.ts
var NUMBER_PROPS = {
  rps: "rps",
  readRps: "rps",
  writeRps: "rps",
  latencyMs: "ms",
  availability: "%",
  costUsd: "usd/month",
  bandwidthMBps: "MBps",
  egressUsdPerGb: "usd/GB"
};
var CHOICE_PROPS = {
  durable: ["true", "false"],
  consistency: ["strong", "eventual"],
  writeScaling: ["replicas", "shards"]
};
var TYPE_LINES = "kind, protocol, op, status, header, icon, doc or a profile number (rps, readRps, writeRps, writeScaling, latencyMs, availability, costUsd, durable, consistency, bandwidthMBps, egressUsdPerGb)";
var HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
var HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
var DEFAULT_TECH = "Rectangle";
var DEFAULT_GROUP_TECH = "Logical Group";
var SYSTEM_TECH = "Service";
var STUB_HELP = "a rate, p99, latency or availability, e.g. capacity { 2k rps p99 150ms availability 99.95% }";
var MAX_SCENARIOS = 32;
var MAX_ALT_DEPTH = 16;
var DIRECTIONS = ["down", "right", "up", "left"];
var REPLICAS = /^x(\d+)$/;
var MULTIPLIER = /^x(\d+(?:\.\d+)?)$/;
var PERCENTILES = { p50: 50, p90: 90, p95: 95, p99: 99, p999: 99.9 };
var FIELD_FLAGS = ["key", "index", "unique", "optional"];
var UNIT_EXAMPLES = {
  rps: "a rate, e.g. 100k rps, 6k rpm or 1m rpd",
  ms: "a duration, e.g. 50ms or 1.5s",
  "%": "a percentage, e.g. 99.9%",
  "usd/month": "a monthly cost, e.g. 400 usd/month",
  MBps: "a bandwidth, e.g. 500 MB/s or 1 GB/s",
  "usd/GB": "a price per gigabyte, e.g. 0.05 usd/GB"
};
var CAPACITY_PARTS = "a rate, reads, writes, shards, size, latency, availability, cost, durable or volatile, consistency, bandwidth, egress, timeout, hit, errors, retries or drain";
var MAX_RETRIES = 5;
var ASSERTION_HELP = 'Expected an assertion: "Use case" calls <node>, "Use case" writes <node> before responding, <node> calls <node>, no path from <node> to <node>, <node> has replicas >= 2, \u2026';
var ASSERTION_VERBS = "calls, uses, sends header, every scenario calls, never calls, never waits for, writes, responds, starts at, has scenario or handles failure of";
var GENERIC_TECH = {
  client: "Actor",
  edge: "WAF",
  cdn: "CDN",
  loadbalancer: "Load Balancer",
  gateway: "API Gateway",
  dns: "DNS",
  service: "Service",
  function: "Function",
  cache: "Cache",
  database: "Database",
  search: "Search Engine",
  analytics: "Data Warehouse",
  queue: "Message Queue",
  broker: "Message Broker",
  storage: "Object Storage",
  external: "Third Party API",
  other: "Note"
};
function unknownTechMessage(tech, kind, suggestion) {
  const simulated = `simulated as a generic ${kind}${suggestion === GENERIC_TECH[kind] ? "" : `, like [${GENERIC_TECH[kind]}]`}`;
  return suggestion ? `Unknown tech stack '${tech}'. Did you mean '${suggestion}'? Until then it is ${simulated}` : `Unknown tech stack '${tech}'; ${simulated}`;
}
function parse(source, options = {}) {
  return new Parser(source, options).run();
}
function parseTypeDecls(source, path) {
  return new Parser(source, { path }, { chain: [path], teamFiles: /* @__PURE__ */ new Map() }).readTypes();
}
function builtinTypes() {
  return loadStdlib(parseTypeDecls).table;
}
var Parser = class _Parser {
  // Per-file state, swapped while an imported file is read.
  lines;
  /** Path of the imported file being read; undefined for the root document. */
  file;
  stack = [];
  diagnostics = [];
  /** Warnings reported so far (see `warning`). */
  warned = /* @__PURE__ */ new Set();
  nodes = /* @__PURE__ */ new Map();
  edges = [];
  /** Connections so far per `from->to`, for the ids of repeated ones. */
  edgeCount = /* @__PURE__ */ new Map();
  useCases = [];
  references = [];
  imports = [];
  /** Files read so far, so a file imported along several paths is included once. */
  included = /* @__PURE__ */ new Set();
  /** Files being read, outermost first, to find import cycles. */
  chain;
  /** Diagnostics are sorted by file in the order the files were first read, the root first. */
  fileOrder;
  /** The file read as the root: undefined for a document, the path for a system's team file (its own scope). */
  rootFile;
  teamFiles;
  systems = [];
  systemById = /* @__PURE__ */ new Map();
  /** `a|b` for every connection, both directions; filled before use cases are built. */
  connected = /* @__PURE__ */ new Set();
  title;
  summary;
  traffic = [];
  requirements = [];
  capacity = [];
  entities = [];
  decisions = [];
  tests = [];
  whatifs = [];
  /** `let` constants by name, from every file read so far. */
  constants = /* @__PURE__ */ new Map();
  blocks = [];
  legend = [];
  layout = {};
  /** Where each top-level layout hint was set, for the duplicate warning. */
  layoutLocs = {};
  /** `.tag` uses, resolved against the legend once every file is read. */
  tagRefs = [];
  /** Checks of use case, scenario and node names, run once every file is read and use cases are built. */
  deferred = [];
  built = [];
  options;
  /** `type` blocks of every file read so far, in order. */
  typeDecls = [];
  /** Node techs, resolved by `resolveTypes` once every file is read. */
  techRefs = [];
  /** Built-in and declared types; set by `resolveTypes`. */
  typeTable = /* @__PURE__ */ new Map();
  /** The declared (not built-in) types, resolved. */
  types = [];
  constructor(source, options, scope2) {
    this.options = options;
    this.lines = source.split("\n");
    this.chain = scope2 ? scope2.chain : [options.path];
    this.teamFiles = scope2?.teamFiles ?? /* @__PURE__ */ new Map();
    if (scope2) this.rootFile = this.file = options.path;
    this.fileOrder = /* @__PURE__ */ new Map([[this.rootFile, 0]]);
    if (options.path !== void 0) this.included.add(options.path);
  }
  run() {
    this.parseFile();
    this.resolveTypes();
    this.resolvePorts();
    this.createImplicitNodes();
    this.resolveTags();
    for (const e of this.edges) this.connected.add(`${e.source}|${e.target}`).add(`${e.target}|${e.source}`);
    const useCases = this.useCases.map(({ useCase, body }) => this.buildUseCase(useCase, body));
    const endpoints = useCases.flatMap((u) => u.endpoint ? [u.endpoint] : []);
    for (const u of useCases) if (u.endpoint) u.endpointGroup = endpointGroupKey(u.endpoint, endpoints);
    this.built = useCases;
    for (const check of this.deferred) check();
    const diagram = {
      title: this.title,
      nodes: [...this.nodes.values()],
      edges: this.edges,
      useCases,
      // The HLD sections are left out when a document has none, so older documents parse exactly as before.
      ...this.summary !== void 0 ? { summary: this.summary } : {},
      ...this.traffic.length ? { traffic: this.traffic } : {},
      ...this.requirements.length ? { requirements: this.requirements } : {},
      ...this.capacity.length ? { capacity: this.capacity } : {},
      ...this.entities.length ? { entities: this.entities } : {},
      ...this.decisions.length ? { decisions: this.decisions } : {},
      ...this.tests.length ? { tests: this.tests } : {},
      ...this.legend.length ? { legend: this.legend } : {},
      ...Object.keys(this.layout).length ? { layout: this.layout } : {},
      ...this.systems.length ? { systems: this.systems } : {},
      ...this.whatifs.length ? { whatifs: this.whatifs } : {},
      ...this.constants.size ? { constants: [...this.constants.values()] } : {},
      ...this.types.length ? { types: this.types } : {}
    };
    const order = (d) => this.fileOrder.get(d.file) ?? 0;
    this.diagnostics.sort((a, b) => order(a) - order(b) || a.line - b.line || a.col - b.col);
    return {
      diagram,
      diagnostics: this.diagnostics,
      ...this.imports.length ? { imports: this.imports } : {},
      ...this.blocks.length ? { blocks: this.blocks } : {}
    };
  }
  /** For `parseTypeDecls`: the file's type blocks and every problem found reading it. */
  readTypes() {
    this.parseFile();
    return { decls: this.typeDecls, diagnostics: this.diagnostics };
  }
  /** Reads the current file's lines and reports blocks it leaves open. */
  parseFile() {
    this.lines.forEach((text, index) => {
      const { tokens, diagnostics } = tokenizeLine(text, index + 1);
      if (isLet(tokens) && diagnostics.length === 0) this.defineConstant(tokens, index + 1);
    });
    for (let i = 0; i < this.lines.length; i++) {
      i = this.parseLine(i);
    }
    for (const frame2 of this.stack) {
      const what = frame2.kind === "group" ? `group '${frame2.id}'` : frame2.kind === "usecase" ? `usecase '${frame2.useCase.name}'` : frame2.kind === "alt" ? `alt '${frame2.name}'` : frame2.kind === "par" ? "par block" : frame2.kind === "system" ? `system '${frame2.system.id}'` : frame2.kind === "stub" ? `the capacity of system '${frame2.system.id}'` : frame2.kind === "type" ? `type '${frame2.decl.name}'` : sectionName(frame2);
      this.error(`Missing } to close ${what}`, frame2.loc);
      if (frame2.kind === "system") this.finishSystem(frame2);
    }
  }
  /** Parses the line at `index` and returns the index of the last line it consumed. */
  parseLine(index) {
    const line = index + 1;
    const typeFrame = this.top();
    if (typeFrame?.kind === "type" && /^\s*header(\s|$)/.test(this.lines[index])) {
      if (!typeFrame.discard) this.parseHeaders(typeFrame.decl, this.lines[index], line);
      return index;
    }
    const { tokens: lexed, diagnostics } = tokenizeLine(this.lines[index], line);
    const tokens = qualify(lexed);
    this.diagnostics.push(...diagnostics.map((d) => ({ ...d, ...this.fileField() })));
    if (tokens.length === 0 || diagnostics.some((d) => d.severity === "error")) return index;
    const [first, second, third] = tokens;
    const loc = (t) => this.locOf(t, line);
    const top = this.top();
    if (isLet(tokens) && !(top?.kind === "section" && top.skipped !== void 0)) {
      if (top) this.error("Define constants at the top level, not inside a block", loc(first));
      return index;
    }
    if (top?.kind === "section") {
      if (top.skipped !== void 0) {
        const opens = tokens[tokens.length - 1].kind === "lbrace";
        if (first.kind !== "rbrace") top.nested = (top.nested ?? 0) + (opens ? 1 : 0);
        else if (top.nested) top.nested += opens ? 0 : -1;
        else {
          this.stack.pop();
          if (second?.kind === "ident" && second.value === "alt") this.parseAlt(tokens.slice(1), line);
          else if (second) this.error("Unexpected input after }", loc(second));
        }
        return index;
      }
      if (first.kind === "rbrace") {
        this.stack.pop();
        if (!top.discard) this.closeSection(top);
        if (!top.discard && this.file === this.rootFile) this.blocks.push({ kind: top.section, start: top.loc.line, end: line });
        if (second) this.error("Unexpected input after }", loc(second));
      } else if (!top.discard) {
        this.parseSectionLine(top, tokens, line);
      }
      return index;
    }
    if (top?.kind === "system" || top?.kind === "stub") {
      this.parseSystemLine(top, tokens, line);
      return index;
    }
    if (top?.kind === "type") {
      if (first.kind === "rbrace") {
        this.stack.pop();
        if (second) this.error("Unexpected input after }", loc(second));
      } else if (!top.discard) {
        this.parseTypeLine(top.decl, tokens, line);
      }
      return index;
    }
    if (first.kind === "rbrace") {
      if (this.stack.length === 0) this.error("Unmatched }", loc(first));
      else this.closeFrame();
      if (second?.kind === "ident" && second.value === "alt") this.parseAlt(tokens.slice(1), line);
      else if (second) this.error("Unexpected input after }", loc(second));
      return index;
    }
    if (first.kind === "ident" && second?.kind === "arrow") {
      return this.parseConnection(tokens, index);
    }
    if (first.kind !== "ident") {
      this.error("Expected a node, connection, group or usecase", loc(first));
      return index;
    }
    switch (first.value) {
      case "title":
        this.parseTitle(tokens, line);
        break;
      case "group":
        this.parseGroup(tokens, line);
        break;
      // A keyword only as `system id … {`, so a node may still be called system.
      case "system":
        if (second?.kind === "ident" && tokens[tokens.length - 1].kind === "lbrace") this.parseSystem(tokens, line);
        else this.parseNode(tokens, line);
        break;
      case "usecase":
        this.parseUseCase(tokens, line);
        break;
      // Keywords only in the shape of a type header, so a node may still be called type or abstract.
      case "type":
        if (isTypeHeader(tokens, 1)) this.parseType(tokens, 1, line);
        else this.parseNode(tokens, line);
        break;
      case "abstract":
        if (isWord(second, "type") && isTypeHeader(tokens, 2)) this.parseType(tokens, 2, line);
        else this.parseNode(tokens, line);
        break;
      case "par":
        this.parsePar(tokens, line);
        break;
      case "alt":
        this.parseAlt(tokens, line);
        break;
      case "import":
        this.parseImport(tokens, line);
        break;
      // These words are keywords only in the shape of their statement, so older documents may still use them as ids.
      case "traffic":
      case "requirements":
      case "capacity":
      case "legend":
        if (second?.kind === "lbrace") this.openSection(first.value, tokens, line);
        else this.parseNode(tokens, line);
        break;
      case "entity":
        if (second?.kind === "ident" && second.value !== "pos" && !REPLICAS.test(second.value)) this.parseEntity(tokens, line);
        else this.parseNode(tokens, line);
        break;
      case "decision":
        if (second?.kind === "string" && (third?.kind === "lbrace" || third?.kind === "ident" && third.value !== "pos" && !REPLICAS.test(third.value)))
          this.parseDecision(tokens, line);
        else this.parseNode(tokens, line);
        break;
      case "test":
        if (second?.kind === "string" && tokens[tokens.length - 1].kind === "lbrace") this.parseTest(tokens, line);
        else this.parseNode(tokens, line);
        break;
      case "whatif":
        if (second?.kind === "string" && tokens[tokens.length - 1].kind === "lbrace") this.parseWhatIf(tokens, line);
        else this.parseNode(tokens, line);
        break;
      // Keywords only as `direction <word>` and `layout <word>`, so a node may still be called direction or layout.
      case "direction":
        if (this.isHint(tokens)) this.parseDirection(tokens, line);
        else this.parseNode(tokens, line);
        break;
      case "layout":
        if (this.isHint(tokens)) this.parseLayoutMode(tokens, line);
        else this.parseNode(tokens, line);
        break;
      default:
        this.parseNode(tokens, line);
    }
    return index;
  }
  parseTitle(tokens, line) {
    const value = tokens[1];
    if (!value || value.kind !== "string" && value.kind !== "ident") {
      this.error('Expected a title, e.g. title "My System"', this.locOf(tokens[0], line));
      return;
    }
    const summary = tokens[2]?.kind === "string" ? tokens[2] : void 0;
    if (this.file === this.rootFile) {
      this.title = value.value;
      if (summary) this.summary = summary.value;
    }
    this.expectEnd(tokens, summary ? 3 : 2, line);
  }
  /** `direction right`, `layout ordered`: a keyword and one plain word that is not a node part. */
  isHint(tokens) {
    const second = tokens[1];
    return tokens.length === 2 && second.kind === "ident" && !["pos", "critical", "color", "rank"].includes(second.value) && !REPLICAS.test(second.value);
  }
  /** `direction down|right|up|left`: at the top level for the whole diagram, inside a group for its members. */
  parseDirection(tokens, line) {
    const [keyword, value] = tokens;
    const loc = this.locOf(value, line);
    if (!DIRECTIONS.includes(value.value)) {
      this.error(`Unknown direction '${value.value}'; use direction down, right, up or left`, loc);
      return;
    }
    const direction = value.value;
    const top = this.top();
    if (top?.kind === "group") {
      const group = this.nodes.get(top.id);
      if (!group || group.loc !== top.loc) return;
      if (group.direction) this.warning(`Group '${group.id}' already has direction ${group.direction}; this one is ignored`, this.locOf(keyword, line));
      else group.direction = direction;
      return;
    }
    if (top) {
      this.error("direction is only allowed at the top level or inside a group", this.locOf(keyword, line));
      return;
    }
    if (this.file !== this.rootFile) return;
    if (this.layoutLocs.direction) {
      this.warning(`direction is already set ${this.where(this.layoutLocs.direction, loc)}; this one is ignored`, this.locOf(keyword, line));
      return;
    }
    this.layout.direction = direction;
    this.layoutLocs.direction = loc;
  }
  /** `layout ordered`: lay edges out by declaration order. */
  parseLayoutMode(tokens, line) {
    const [keyword, value] = tokens;
    const loc = this.locOf(value, line);
    if (value.value !== "ordered") {
      this.error(`Unknown layout mode '${value.value}'; the only one is layout ordered`, loc);
      return;
    }
    if (this.top()) {
      this.error("layout ordered applies to the whole diagram; write it at the top level", this.locOf(keyword, line));
      return;
    }
    if (this.file !== this.rootFile) return;
    if (this.layoutLocs.ordered) {
      this.warning(`layout ordered is already set ${this.where(this.layoutLocs.ordered, loc)}`, this.locOf(keyword, line));
      return;
    }
    this.layout.ordered = true;
    this.layoutLocs.ordered = loc;
  }
  /**
   * `rank 2`, `rank first`, `rank last` at `i` in a node or group header.
   * Returns how many tokens it used (0 when the token is something else), or
   * undefined after reporting an error.
   */
  readRank(tokens, i, line, current) {
    const t = tokens[i];
    if (!isWord(t, "rank")) return 0;
    const value = tokens[i + 1];
    const help = "a layer number from 0 (rank 0, rank 1, \u2026), rank first or rank last";
    if (current.rank !== void 0) {
      this.error(`A node takes one rank; rank ${current.rank} is already set`, this.locOf(t, line));
      return void 0;
    }
    if (value?.kind === "number" && /^\d+$/.test(value.value)) {
      current.rank = Number(value.value);
      return 2;
    }
    if (value?.kind === "ident" && (value.value === "first" || value.value === "last")) {
      current.rank = value.value;
      return 2;
    }
    const numeric = value?.kind === "number" || value?.kind === "quantity";
    this.error(numeric ? `'${value.value}' is not a layer number; use ${help}` : `Expected ${help} after rank`, this.locOf(value ?? t, line));
    return void 0;
  }
  parseImport(tokens, line) {
    const keyword = tokens[0];
    if (this.stack.length > 0) {
      this.error("import is only allowed at the top level", this.locOf(keyword, line));
      return;
    }
    const pathToken = tokens[1];
    if (pathToken?.kind !== "string" || !pathToken.value.trim()) {
      this.error('Expected a file path, e.g. import "infra.proschi"', this.locOf(pathToken ?? keyword, line));
      return;
    }
    this.expectEnd(tokens, 2, line);
    const path = pathToken.value;
    const loc = this.locOf(pathToken, line);
    const entry = { path, loc };
    this.imports.push(entry);
    const { resolve } = this.options;
    if (!resolve) {
      this.warning(`Imports are not resolved in this context; '${path}' was not loaded`, loc);
      return;
    }
    const target = this.resolveFile(path, loc);
    if (!target) return;
    entry.resolved = target.path;
    const cycleStart = this.chain.indexOf(target.path);
    if (cycleStart !== -1) {
      const names = [...this.chain.slice(cycleStart), target.path].map((p) => fileName(p ?? ""));
      this.error(`Import cycle: ${names.join(" \u2192 ")}`, loc);
      return;
    }
    if (this.included.has(target.path)) return;
    this.included.add(target.path);
    this.fileOrder.set(target.path, this.fileOrder.size);
    const outer = { lines: this.lines, file: this.file, stack: this.stack };
    this.lines = target.source.split("\n");
    this.file = target.path;
    this.stack = [];
    this.chain.push(target.path);
    this.parseFile();
    this.chain.pop();
    ({ lines: this.lines, file: this.file, stack: this.stack } = outer);
  }
  /**
   * Loads `path` through the resolver, relative to the file being read. A
   * resolver error named `ImportError` (outside the project root, not synced,
   * …) is reported with its own message; anything else is "Cannot find".
   */
  resolveFile(path, loc) {
    let target;
    try {
      target = this.options.resolve?.(path, this.file ?? this.options.path);
    } catch (e) {
      if (e instanceof Error && e.name === "ImportError") {
        this.error(e.message, loc);
        return void 0;
      }
      target = void 0;
    }
    if (!target) this.error(`Cannot find '${path}'`, loc);
    return target;
  }
  parseGroup(tokens, line) {
    const keyword = tokens[0];
    const top = this.top();
    if (top && top.kind !== "group") {
      this.error("Groups cannot be declared inside a usecase", this.locOf(keyword, line));
      return;
    }
    const idToken = tokens[1];
    if (idToken?.kind !== "ident") {
      this.error('Expected a group id, e.g. group vpc "AWS VPC" {', this.locOf(keyword, line));
      return;
    }
    let i = 2;
    let name = idToken.value;
    let techStack = DEFAULT_GROUP_TECH;
    if (tokens[i]?.kind === "string") name = tokens[i++].value;
    if (tokens[i]?.kind === "tech") {
      const tech = tokens[i++];
      const resolved = findTech(tech.value);
      if (resolved?.type === "group") techStack = resolved.techStack;
      else this.warning(`'${tech.value}' is not a group style; using ${DEFAULT_GROUP_TECH}`, this.locOf(tech, line));
    }
    let position;
    const style = {};
    const ranked = {};
    while (i < tokens.length && tokens[i].kind !== "lbrace") {
      const rankUsed = this.readRank(tokens, i, line, ranked);
      if (rankUsed === void 0) return;
      if (rankUsed) {
        i += rankUsed;
        continue;
      }
      if (tokens[i].kind === "ident" && tokens[i].value === "pos") {
        const [x, comma, y] = [tokens[i + 1], tokens[i + 2], tokens[i + 3]];
        if (x?.kind !== "number" || comma?.kind !== "comma" || y?.kind !== "number") {
          this.error("Expected pos x,y", this.locOf(tokens[i], line));
          return;
        }
        position = { x: Number(x.value), y: Number(y.value) };
        i += 4;
        continue;
      }
      const used = this.readStylePart(tokens, i, line, style, false);
      if (used === void 0) return;
      if (used === 0) break;
      i += used;
    }
    if (tokens[i]?.kind !== "lbrace") {
      this.error("Expected { after group header", this.locOf(tokens[i] ?? tokens[i - 1], line));
      return;
    }
    this.expectEnd(tokens, i + 1, line);
    const loc = this.locOf(idToken, line);
    const group = { id: idToken.value, kind: "group", name, type: "group", techStack, parent: this.currentGroup(), position, loc };
    if (ranked.rank !== void 0) group.rank = ranked.rank;
    this.applyStyle(group, style);
    this.addNode(group);
    this.stack.push({ kind: "group", id: idToken.value, loc });
  }
  // ---- Systems: a team's design behind a contract (docs/design/team-systems-and-imports.md) ----
  /** `system id ["Name"] [@team] [pos x,y] [color c] [.tag] [rank N] {` */
  parseSystem(tokens, line) {
    const [keyword, idToken] = tokens;
    const top = this.top();
    if (top && top.kind !== "group") {
      this.error("A system is declared at the top level or inside a group", this.locOf(keyword, line));
      this.skipSection("test", tokens, line);
      return;
    }
    const loc = this.locOf(idToken, line);
    const node = { id: idToken.value, kind: "system", name: idToken.value, type: "service", techStack: SYSTEM_TECH, parent: this.currentGroup(), loc };
    const style = {};
    let named = false;
    let i = 2;
    while (i < tokens.length - 1) {
      const t = tokens[i];
      const styleUsed = this.readStylePart(tokens, i, line, style, false);
      const used = styleUsed === 0 ? this.readRank(tokens, i, line, node) : styleUsed;
      if (used === void 0) return this.skipSection("test", tokens, line);
      if (used > 0) {
        i += used;
        continue;
      }
      if (t.kind === "string" && !named) {
        node.name = t.value;
        named = true;
      } else if (t.kind === "string" && node.description === void 0) {
        node.description = t.value;
      } else if (t.kind === "team") {
        node.ownerTeam = t.value;
      } else if (isWord(t, "pos")) {
        const [x, comma, y] = [tokens[i + 1], tokens[i + 2], tokens[i + 3]];
        if (x?.kind !== "number" || comma?.kind !== "comma" || y?.kind !== "number") {
          this.error("Expected pos x,y", this.locOf(t, line));
          return this.skipSection("test", tokens, line);
        }
        node.position = { x: Number(x.value), y: Number(y.value) };
        i += 3;
      } else {
        this.error(`Unexpected ${describe(t)} in system header; write system id "Name" @Team {`, this.locOf(t, line));
        return this.skipSection("test", tokens, line);
      }
      i++;
    }
    this.applyStyle(node, style);
    const system = { id: node.id, entries: [], loc };
    if (!this.nodes.has(node.id)) {
      this.systems.push(system);
      this.systemById.set(system.id, system);
    }
    this.addNode(node);
    this.stack.push({ kind: "system", system, useCaseLocs: /* @__PURE__ */ new Map(), loc });
  }
  /** A line inside `system … { }` or its multi-line `capacity { }`. */
  parseSystemLine(frame2, tokens, line) {
    const [first, second] = tokens;
    const { system } = frame2;
    if (first.kind === "rbrace") {
      this.stack.pop();
      if (frame2.kind === "system") this.finishSystem(frame2);
      if (second) this.error("Unexpected input after }", this.locOf(second, line));
      return;
    }
    if (frame2.kind === "stub") {
      this.readStub(system.stub, tokens, 0, tokens.length, line);
      return;
    }
    if (isWord(first, "from")) {
      if (second?.kind !== "string" || !second.value.trim()) {
        this.error('Expected the team file, e.g. from "teams/orders.proschi"', this.locOf(second ?? first, line));
        return;
      }
      if (system.from !== void 0) {
        this.error(`System '${system.id}' already has from "${system.from}"`, this.locOf(first, line));
        return;
      }
      this.expectEnd(tokens, 2, line);
      system.from = second.value;
      frame2.fromLoc = this.locOf(second, line);
      return;
    }
    if (isWord(first, "expose")) return this.parseExpose(frame2, tokens, line);
    if (isWord(first, "capacity") && second?.kind === "lbrace") {
      const opens = tokens[tokens.length - 1].kind !== "rbrace";
      if (system.stub) {
        this.error(`System '${system.id}' already has a capacity`, this.locOf(first, line));
        if (opens) this.stack.push({ kind: "section", section: "capacity", discard: true, loc: this.locOf(first, line) });
        return;
      }
      const stub = { loc: this.lineLoc(tokens, line) };
      system.stub = stub;
      this.readStub(stub, tokens, 2, opens ? tokens.length : tokens.length - 1, line);
      if (opens) this.stack.push({ kind: "stub", system, loc: this.locOf(first, line) });
      return;
    }
    this.error('Inside a system, write from "file", expose <id> "Name" -> "Use case" or capacity { \u2026 }', this.locOf(first, line));
    if (tokens[tokens.length - 1].kind === "lbrace") this.stack.push({ kind: "section", section: "test", discard: true, loc: this.locOf(first, line) });
  }
  /** `expose id ["Name"] [-> "Use case"]` */
  parseExpose(frame2, tokens, line) {
    const [keyword, idToken] = tokens;
    if (idToken?.kind !== "ident") {
      this.error('Expected an entry point id, e.g. expose api "Orders API" -> "Place order"', this.locOf(idToken ?? keyword, line));
      return;
    }
    const entry = { id: idToken.value, name: idToken.value, loc: this.locOf(idToken, line) };
    let i = 2;
    if (tokens[i]?.kind === "string") entry.name = tokens[i++].value;
    if (tokens[i]?.kind === "arrow") {
      const useCase = tokens[i + 1];
      if (tokens[i].value !== "->" || useCase?.kind !== "string" && useCase?.kind !== "ident") {
        this.error('Expected -> "Use case" after the entry point', this.locOf(useCase ?? tokens[i], line));
        return;
      }
      entry.useCase = useCase.value;
      frame2.useCaseLocs.set(entry, this.locOf(useCase, line));
      i += 2;
    }
    if (!this.expectEnd(tokens, i, line)) return;
    if (frame2.system.entries.some((e) => e.id === entry.id)) {
      this.error(`System '${frame2.system.id}' already exposes '${entry.id}'`, entry.loc);
      return;
    }
    frame2.system.entries.push(entry);
  }
  /** The parts of a system's `capacity { … }` in `tokens[from, to)`. */
  readStub(stub, tokens, from, to, line) {
    for (let i = from; i < to; ) {
      const t = tokens[i];
      if (t.kind === "quantity" || t.kind === "number" || isConstUse(t)) {
        const rps = this.quantityOf(t, "rps", t, line);
        if (rps === void 0) return;
        stub.rps = rps;
        i++;
      } else if (isWord(t, "p99") || isWord(t, "latency") || isWord(t, "availability")) {
        const value = this.quantityOf(i + 1 < to ? tokens[i + 1] : void 0, t.value === "availability" ? "%" : "ms", t, line);
        if (value === void 0) return;
        if (t.value === "p99") stub.p99Ms = value;
        else if (t.value === "latency") stub.latencyMs = value;
        else stub.availability = value;
        i += 2;
      } else {
        this.error(`Expected ${STUB_HELP}`, this.locOf(t, line));
        return;
      }
    }
  }
  /** At the system's `}`: loads the team file and checks the entry points against its use cases. */
  finishSystem(frame2) {
    const { system } = frame2;
    if (system.from !== void 0) {
      const team2 = this.loadTeam(system.from, frame2.fromLoc ?? system.loc);
      if (team2) {
        system.resolved = team2.path;
        system.diagram = team2.diagram;
      }
      if (system.stub) {
        this.warning(`System '${system.id}' has a from file, which sets its contract; this capacity is ignored`, system.stub.loc);
        if (team2) delete system.stub;
      }
    } else if (!system.stub) {
      this.warning(`System '${system.id}' has no from "file" and no capacity { \u2026 }; it is drawn but not simulated`, system.loc);
    }
    const team = system.diagram;
    if (!team) return;
    const name = fileName(system.resolved ?? "");
    for (const entry of system.entries) {
      const wanted = entry.useCase;
      if (wanted !== void 0) {
        const u = findUseCaseIn(team, wanted);
        if (u) entry.useCaseId = u.id;
        else {
          const near = team.useCases.find((x) => editDistance2(x.name.toLowerCase(), wanted.toLowerCase()) <= Math.max(1, Math.floor(wanted.length / 4)));
          const all = team.useCases.map((x) => `"${x.name}"`).join(", ");
          const help = near ? ` Did you mean "${near.name}"?` : all ? ` Its use cases are ${all}` : "";
          this.error(`${name} has no use case "${wanted}".${help}`, frame2.useCaseLocs.get(entry) ?? entry.loc);
        }
      } else if (team.useCases.length === 1) {
        entry.useCaseId = team.useCases[0].id;
      } else if (team.useCases.length === 0) {
        this.error(`${name} has no use case for '${entry.id}' to enter`, entry.loc);
      } else {
        this.error(`Say which use case '${entry.id}' enters, e.g. expose ${entry.id} -> "${team.useCases[0].name}"`, entry.loc);
      }
    }
    if (system.entries.length === 0) this.warning(`System '${system.id}' exposes no entry point; add expose <id> -> "Use case" so others can call it`, system.loc);
  }
  /** Parses a team file in its own scope (once per root parse), through the import resolver. */
  loadTeam(path, loc) {
    if (!this.options.resolve) {
      this.warning(`Files are not resolved in this context; '${path}' was not loaded`, loc);
      return void 0;
    }
    const target = this.resolveFile(path, loc);
    if (!target) return void 0;
    const cycleStart = this.chain.indexOf(target.path);
    if (cycleStart !== -1) {
      const names = [...this.chain.slice(cycleStart), target.path].map((p) => fileName(p ?? ""));
      this.error(`System cycle: ${names.join(" \u2192 ")}`, loc);
      return void 0;
    }
    let result = this.teamFiles.get(target.path);
    if (!result) {
      const scope2 = { chain: [...this.chain, target.path], teamFiles: this.teamFiles };
      result = new _Parser(target.source, { path: target.path, resolve: this.options.resolve, ...this.options.strictOps ? { strictOps: true } : {} }, scope2).run();
      this.teamFiles.set(target.path, result);
      for (const d of result.diagnostics) {
        if (!this.fileOrder.has(d.file)) this.fileOrder.set(d.file, this.fileOrder.size);
        this.diagnostics.push(d);
      }
    }
    return { path: target.path, diagram: result.diagram };
  }
  /**
   * Resolves `orders.api` references once every file is read: the entry point
   * `api` of system `orders`. Edges and references then name the system, with
   * the entry point in `sourcePort` / `targetPort`. On a connection to a
   * non-system, `b.planned` stays what it always was: `b` with a tag.
   */
  resolvePorts() {
    for (const ref of this.references) {
      const dot = ref.id.indexOf(".");
      if (dot === -1) continue;
      const prefix = ref.id.slice(0, dot);
      const port = ref.id.slice(dot + 1);
      const system = this.systemById.get(prefix);
      if (system) {
        if (!system.entries.some((e) => e.id === port)) this.error(this.unexposedMessage(system, port), ref.loc);
      } else if (ref.edgeTarget) {
        ref.edgeTarget.tag = port;
        this.tagRefs.push({ tag: port, loc: { ...ref.loc, col: ref.loc.col + dot, length: ref.loc.length - dot }, target: ref.edgeTarget });
      } else {
        this.error(`'${prefix}' is not a system, so '${ref.id}' names nothing; write ${prefix}, or declare system ${prefix} { \u2026 }`, ref.loc);
      }
      ref.id = prefix;
    }
    for (const edge of this.edges) {
      const [source, sourcePort] = this.splitRef(edge.source);
      const [target, targetPort] = this.splitRef(edge.target);
      edge.source = source;
      edge.target = target;
      if (sourcePort !== void 0) edge.sourcePort = sourcePort;
      if (targetPort !== void 0) edge.targetPort = targetPort;
    }
  }
  unexposedMessage(system, port) {
    const entries2 = system.entries.map((e) => `${system.id}.${e.id}`);
    const known = entries2.length ? `; connect to ${entries2.join(" or ")}` : "";
    const internal = system.diagram?.nodes.some((n) => n.id === port);
    return internal ? `'${port}' is inside system '${system.id}' but is not an entry point; only entry points are reachable from outside: add expose ${port} -> "Use case"${known}` : `System '${system.id}' has no entry point '${port}'${known}`;
  }
  /** `orders.api` → `['orders', 'api']` when `orders` is a system; else the id up to its dot, without a port. */
  splitRef(id) {
    const dot = id.indexOf(".");
    if (dot === -1) return [id, void 0];
    const prefix = id.slice(0, dot);
    return [prefix, this.systemById.has(prefix) ? id.slice(dot + 1) : void 0];
  }
  /** A step to a whole system enters its only entry point; with several it must name one. */
  onlyEntry(id, loc) {
    const system = this.systemById.get(id);
    if (!system || system.entries.length === 0) return void 0;
    if (system.entries.length === 1) return system.entries[0].id;
    this.errorOnce(`Say which entry point of '${id}' this step enters: ${system.entries.map((e) => `${id}.${e.id}`).join(" or ")}`, loc);
    return void 0;
  }
  parseUseCase(tokens, line) {
    const keyword = tokens[0];
    if (this.stack.length > 0) {
      this.error("A usecase must be declared at the top level", this.locOf(keyword, line));
      return;
    }
    const nameToken = tokens[1];
    if (nameToken?.kind !== "string" && nameToken?.kind !== "ident") {
      this.error('Expected a usecase name, e.g. usecase "Place order" {', this.locOf(keyword, line));
      return;
    }
    let i = 2;
    let description;
    if (tokens[i]?.kind === "string") description = tokens[i++].value;
    if (tokens[i]?.kind !== "lbrace") {
      this.error("Expected { after usecase name", this.locOf(tokens[i] ?? tokens[i - 1], line));
      return;
    }
    this.expectEnd(tokens, i + 1, line);
    const loc = this.locOf(nameToken, line);
    const useCase = { id: this.useCaseId(nameToken.value), name: nameToken.value, description, steps: [], scenarios: [], loc };
    const frame2 = { kind: "usecase", useCase, body: { items: [] }, parCount: 0, loc };
    this.useCases.push({ useCase, body: frame2.body });
    this.stack.push(frame2);
  }
  parseAlt(tokens, line) {
    const keyword = tokens[0];
    const top = this.top();
    if (top?.kind !== "usecase" && top?.kind !== "alt") {
      this.error(top?.kind === "par" ? "alt blocks cannot be inside a par block" : "alt is only allowed inside a usecase", this.locOf(keyword, line));
      return;
    }
    const nameToken = tokens[1];
    if (nameToken?.kind !== "string" && nameToken?.kind !== "ident") {
      this.error('Expected a scenario name, e.g. alt "Not found" {', this.locOf(keyword, line));
      return;
    }
    let i = 2;
    let condition;
    if (tokens[i]?.kind === "ident" && tokens[i].value === "when") {
      const conditionToken = tokens[i + 1];
      if (conditionToken?.kind !== "string") {
        this.error('Expected a condition after when, e.g. alt "Not found" when "the order does not exist" {', this.locOf(conditionToken ?? tokens[i], line));
        return;
      }
      condition = conditionToken.value.trim() || void 0;
      i += 2;
    }
    if (tokens[i]?.kind !== "lbrace") {
      this.error(i === 2 ? "Expected { after alt name" : "Expected { after the alt condition", this.locOf(tokens[i] ?? tokens[i - 1], line));
      return;
    }
    this.expectEnd(tokens, i + 1, line);
    if (this.stack.filter((f) => f.kind === "alt").length >= MAX_ALT_DEPTH) {
      const loc2 = this.locOf(keyword, line);
      this.error(`alt blocks can nest at most ${MAX_ALT_DEPTH} deep; this one is skipped`, loc2);
      this.stack.push({ kind: "section", section: "test", discard: true, skipped: `alt '${nameToken.value}'`, loc: loc2 });
      return;
    }
    const owner = top.body;
    let set = owner.openAlt;
    if (!set) {
      set = { kind: "alt", branches: [] };
      owner.items.push(set);
    }
    const loc = this.locOf(nameToken, line);
    if (set.branches.some((b) => b.name === nameToken.value)) this.warning(`Duplicate alt name '${nameToken.value}'`, loc);
    const body = { items: [] };
    set.branches.push({ name: nameToken.value, condition, items: body.items, loc });
    owner.openAlt = void 0;
    this.stack.push({ kind: "alt", name: nameToken.value, body, owner, set, loc });
  }
  closeFrame() {
    const frame2 = this.stack.pop();
    if (frame2?.kind === "alt") frame2.owner.openAlt = frame2.set;
  }
  parsePar(tokens, line) {
    const keyword = tokens[0];
    const top = this.top();
    if (top?.kind !== "usecase" && top?.kind !== "alt") {
      this.error(top?.kind === "par" ? "par blocks cannot be nested" : "par is only allowed inside a usecase", this.locOf(keyword, line));
      return;
    }
    if (tokens[1]?.kind !== "lbrace") {
      this.error("Expected { after par", this.locOf(tokens[1] ?? keyword, line));
      return;
    }
    this.expectEnd(tokens, 2, line);
    top.body.openAlt = void 0;
    const useCase = this.currentUseCase();
    useCase.parCount++;
    this.stack.push({ kind: "par", group: useCase.parCount, loc: this.locOf(keyword, line) });
  }
  parseNode(tokens, line) {
    const idToken = tokens[0];
    const loc = this.locOf(idToken, line);
    if (this.inUseCase()) {
      this.error("Declare nodes outside usecase blocks; steps look like a -> b : label", loc);
      return;
    }
    const node = { id: idToken.value, kind: "component", name: idToken.value, type: "shape", techStack: DEFAULT_TECH, parent: this.currentGroup(), loc };
    let strings = 0;
    const style = {};
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      const styleUsed = this.readStylePart(tokens, i, line, style, true);
      const used = styleUsed === 0 ? this.readRank(tokens, i, line, node) : styleUsed;
      if (used === void 0) return;
      if (used > 0) {
        i += used - 1;
        continue;
      }
      if (t.kind === "string" && strings < 2) {
        if (strings++ === 0) node.name = t.value;
        else node.description = t.value;
      } else if (t.kind === "tech") {
        const found = findTech(t.value);
        if (found) {
          node.type = found.type;
          node.techStack = found.techStack;
          node.kind = found.type === "text" ? "text" : found.type === "group" ? "group" : "component";
        }
        this.techRefs.push({ node, value: t.value, loc: this.locOf(t, line) });
      } else if (t.kind === "team") {
        node.ownerTeam = t.value;
      } else if (t.kind === "ident" && t.value === "pos") {
        const [x, comma, y] = [tokens[i + 1], tokens[i + 2], tokens[i + 3]];
        if (x?.kind !== "number" || comma?.kind !== "comma" || y?.kind !== "number") {
          this.error("Expected pos x,y", this.locOf(t, line));
          return;
        }
        node.position = { x: Number(x.value), y: Number(y.value) };
        i += 3;
      } else if (t.kind === "ident" && REPLICAS.test(t.value)) {
        const replicas = Number(REPLICAS.exec(t.value)[1]);
        if (replicas < 1) {
          this.error("A node needs at least one replica: x1, x2, \u2026", this.locOf(t, line));
          return;
        }
        node.replicas = replicas;
      } else if (t.kind === "const") {
        const replicas = this.replicasOf(t, line, "A node needs a whole number of replicas, at least 1: x1, x2, \u2026");
        if (replicas === void 0) return;
        node.replicas = replicas;
      } else if (t.kind === "label" || t.kind === "arrow") {
        this.error(`Expected '${idToken.value} -> target' for a connection`, this.locOf(t, line));
        return;
      } else {
        this.error(`Unexpected ${describe(t)} in node declaration`, this.locOf(t, line));
        return;
      }
    }
    this.applyStyle(node, style);
    this.addNode(node);
  }
  parseConnection(tokens, index) {
    const line = index + 1;
    const [fromToken, arrowToken, toToken] = tokens;
    const tagToken = tokens[3]?.kind === "tag" ? tokens[3] : void 0;
    const labelToken = tokens[tagToken ? 4 : 3];
    if (toToken?.kind !== "ident") {
      this.error("Expected a target id after the arrow", this.locOf(toToken ?? arrowToken, line));
      return index;
    }
    if (tagToken && tokens[4]?.kind === "tag") {
      this.error("A connection takes one tag", this.locOf(tokens[4], line));
      return index;
    }
    if (tokens.length > (tagToken ? 5 : 4) || labelToken && labelToken.kind !== "label") {
      this.error("Expected : before the connection label", this.locOf(labelToken, line));
      return index;
    }
    let label = labelToken?.value ?? "";
    let lastLine = index;
    const brackets = new BracketCounter();
    let depth = brackets.feed(label);
    if (depth > 0) {
      while (depth > 0 && lastLine + 1 < this.lines.length) {
        lastLine++;
        const more = "\n" + this.lines[lastLine];
        label += more;
        depth = brackets.feed(more);
      }
      if (depth > 0) this.error("Unclosed { or [ in payload", this.locOf(labelToken, line));
      label = label.trimEnd();
    }
    const loc = {
      line,
      col: fromToken.col,
      length: (labelToken ?? toToken).col + (labelToken ?? toToken).length - fromToken.col,
      ...this.fileField()
    };
    const from = fromToken.value;
    const to = toToken.value;
    const arrow = arrowToken.value;
    const toRef = { id: to, loc: this.locOf(toToken, line) };
    this.references.push({ id: from, loc: this.locOf(fromToken, line) }, toRef);
    const top = this.top();
    const inUseCase = top?.kind === "usecase" || top?.kind === "alt" || top?.kind === "par";
    if (tagToken && inUseCase) {
      this.error("Tags style connections in the architecture, not use case steps", this.locOf(tagToken, line));
      return lastLine;
    }
    if (inUseCase) {
      const body = this.currentBody();
      body.openAlt = void 0;
      const prefixes = arrow === "-->" ? { rest: label, col: labelToken && this.labelStart(labelToken, line) } : this.readLabelPrefixes(label, labelToken, line);
      body.items.push({
        kind: "step",
        step: {
          from,
          to,
          arrow,
          label: prefixes.rest,
          parallelGroup: top.kind === "par" ? top.group : void 0,
          ...prefixes.multiplier !== void 0 ? { multiplier: prefixes.multiplier } : {},
          ...prefixes.sizeBytes !== void 0 ? { sizeBytes: prefixes.sizeBytes } : {},
          ...prefixes.col !== void 0 ? { labelCol: prefixes.col } : {},
          loc
        }
      });
    } else if (arrow === "-x") {
      this.error("'-x' marks a failed call and is only allowed in use case steps", this.locOf(arrowToken, line));
    } else {
      const base = `${from}->${to}`;
      const count = this.edgeCount.get(base) ?? 0;
      this.edgeCount.set(base, count + 1);
      const edge = { id: count ? `${base}#${count + 1}` : base, source: from, target: to, label: unquote(label) || void 0, loc };
      if (tagToken) {
        edge.tag = tagToken.value;
        this.tagRefs.push({ tag: tagToken.value, loc: this.locOf(tagToken, line), target: edge });
      }
      if (!tagToken) toRef.edgeTarget = edge;
      this.edges.push(edge);
    }
    return lastLine;
  }
  /**
   * Reads `x<N>` (fan-out) and `~<size>` (payload size) at the start of a step
   * label, in either order (§7.3), and returns the label without them. A
   * prefix must be followed by whitespace or end the label, so `xml …` and
   * `x-request-id` are ordinary labels. Problems are reported at the prefix.
   */
  readLabelPrefixes(label, token, line) {
    const out = { rest: label };
    if (!token) return out;
    const base = this.labelStart(token, line);
    let offset = 0;
    for (; ; ) {
      const rest = label.slice(offset);
      const at = (length) => ({ line, col: base + offset, length, ...this.fileField() });
      const fanOut = /^x(\d+)(?=\s|$)/.exec(rest);
      const size = rest.startsWith("~") ? /^~(\S*)/.exec(rest) : null;
      const match = fanOut ?? size;
      if (!match) break;
      if (fanOut) {
        const n = Number(fanOut[1]);
        if (out.multiplier !== void 0) this.error("The fan-out is given twice; write one x<N>", at(match[0].length));
        else if (n < 1) this.error("A fan-out needs at least one call per request: x1, x2, \u2026", at(match[0].length));
        else out.multiplier = n;
      } else {
        const bytes = parseSize(size[1]);
        if (out.sizeBytes !== void 0) this.error("The payload size is given twice; write one ~<size>", at(match[0].length));
        else if ("error" in bytes) this.error(bytes.error, at(match[0].length));
        else out.sizeBytes = bytes.value;
      }
      offset += match[0].length;
      offset += label.slice(offset).length - label.slice(offset).trimStart().length;
    }
    out.rest = label.slice(offset);
    out.col = base + offset;
    return out;
  }
  /** Column of a label's first character: the label token starts at ':' and its value is trimmed. */
  labelStart(token, line) {
    const after2 = this.lines[line - 1].slice(token.col);
    return token.col + 1 + (after2.length - after2.trimStart().length);
  }
  // ---- HLD sections: traffic, requirements, capacity, entity, decision, test (docs/design/hld-and-practice.md §1) ----
  /**
   * Starts a section block. Sections are top level only; a misplaced one, or
   * one whose header is broken, still opens a block so that its lines and its
   * `}` are not mistaken for nodes and the end of an enclosing block.
   */
  openSection(section, tokens, line, fill2 = {}) {
    const keyword = tokens[0];
    const loc = this.locOf(keyword, line);
    if (this.stack.length > 0) {
      this.error(`${section} is only allowed at the top level`, loc);
      this.skipSection(section, tokens, line);
      return false;
    }
    if (section === "traffic" || section === "requirements" || section === "capacity" || section === "legend") this.expectEnd(tokens, 2, line);
    this.stack.push({ kind: "section", section, ...fill2, loc });
    return true;
  }
  /** After an error in a section header: skips the block, if the line opens one. */
  skipSection(section, tokens, line) {
    if (tokens[tokens.length - 1].kind === "lbrace") this.stack.push({ kind: "section", section, discard: true, loc: this.locOf(tokens[0], line) });
  }
  closeSection(frame2) {
    if (frame2.test && frame2.test.assertions.length === 0) this.warning(`Test '${frame2.test.name}' has no assertions`, frame2.test.loc);
    if (frame2.whatif && frame2.whatif.changes.length === 0) this.warning(`What-if '${frame2.whatif.name}' changes nothing`, frame2.whatif.loc);
  }
  parseSectionLine(frame2, tokens, line) {
    switch (frame2.section) {
      case "traffic":
        return this.parseTrafficLine(tokens, line);
      case "requirements":
        return this.parseRequirement(tokens, line);
      case "capacity":
        return this.parseCapacityLine(tokens, line);
      case "legend":
        return this.parseLegendLine(tokens, line);
      case "entity":
        return this.parseField(frame2.entity, tokens, line);
      case "decision":
        return this.parseDecisionLine(frame2.decision, tokens, line);
      case "test": {
        const assertion2 = this.parseAssertion(tokens, line);
        if (assertion2) frame2.test.assertions.push(assertion2);
        return;
      }
      case "whatif":
        return this.parseWhatIfLine(frame2.whatif, tokens, line);
    }
  }
  /**
   * Reads one style part of a node or group header at `i`: `color <name|#hex>`,
   * `.tag` and, on nodes, `critical`. Returns how many tokens it used (0 when
   * the token is something else), or undefined after reporting an error.
   */
  readStylePart(tokens, i, line, parts, isNode) {
    const t = tokens[i];
    if (t.kind === "tag") {
      if (parts.tag) {
        this.error(`A ${isNode ? "node" : "group"} takes one tag; '.${parts.tag.value}' is already set`, this.locOf(t, line));
        return void 0;
      }
      parts.tag = { value: t.value, loc: this.locOf(t, line) };
      return 1;
    }
    if (isWord(t, "color")) {
      const value = this.readColor(tokens[i + 1], t, line);
      if (value === void 0) return void 0;
      parts.color = value;
      return 2;
    }
    if (isNode && isWord(t, "critical")) {
      parts.critical = true;
      return 1;
    }
    return 0;
  }
  /** The color in `token`, a palette name or `#hex`, or undefined after reporting an error. */
  readColor(token, after2, line) {
    const choices = `${COLOR_NAMES.join(", ")}, or a hex value after color, like color #3b82f6`;
    if (token?.kind !== "ident" && token?.kind !== "hex") {
      this.error(`Expected a color after ${after2.value}: ${choices}`, this.locOf(token ?? after2, line));
      return void 0;
    }
    const hex2 = resolveColor(token.value);
    if (!hex2) {
      const suggestion = suggestColor(token.value);
      this.error(`Unknown color '${token.value}'.${suggestion ? ` Did you mean '${suggestion}'?` : ""} Use ${choices}`, this.locOf(token, line));
      return void 0;
    }
    return { name: token.value, hex: hex2 };
  }
  applyStyle(node, parts) {
    if (parts.color) {
      node.color = parts.color.name;
      node.style = { color: parts.color.hex };
    }
    if (parts.critical) node.critical = true;
    if (parts.tag) {
      node.tag = parts.tag.value;
      this.tagRefs.push({ tag: parts.tag.value, loc: parts.tag.loc, target: node });
    }
  }
  /** `owned "Owned by Order Fulfillment" green dashed`: an id, a label, then a color and a dash in any order. */
  parseLegendLine(tokens, line) {
    const [idToken] = tokens;
    if (idToken.kind !== "ident") {
      this.error('Expected a legend entry, e.g. owned "Owned by us" green', this.locOf(idToken, line));
      return;
    }
    const loc = this.locOf(idToken, line);
    const entry = { id: idToken.value, label: idToken.value, loc };
    let i = 1;
    if (tokens[i]?.kind === "string") entry.label = tokens[i++].value;
    for (; i < tokens.length; i++) {
      const t = tokens[i];
      if (isWord(t, "dashed") || isWord(t, "dotted")) {
        entry.dash = t.value;
        continue;
      }
      if (t.kind === "ident") {
        const keyword = t.value === "color";
        const color = this.readColor(keyword ? tokens[i + 1] : t, t, line);
        if (!color) return;
        entry.colorName = color.name;
        entry.color = color.hex;
        if (keyword) i++;
        continue;
      }
      this.error(`Unexpected ${describe(t)} in legend entry; expected a color, dashed or dotted`, this.locOf(t, line));
      return;
    }
    const existing = this.legend.find((e) => e.id === entry.id);
    if (existing) {
      this.error(`Duplicate legend entry '${entry.id}' (first declared ${this.where(existing.loc, loc)})`, loc);
      return;
    }
    this.legend.push(entry);
  }
  /** Applies each `.tag` once every file is read; an unknown tag is an error. An explicit `color` wins over the tag's (D4). */
  resolveTags() {
    const entries2 = new Map(this.legend.map((e) => [e.id, e]));
    for (const ref of this.tagRefs) {
      const entry = entries2.get(ref.tag);
      if (!entry) {
        const close = [...entries2.keys()].find((id) => editDistance2(id, ref.tag) <= 2);
        const hint = close ? ` Did you mean '.${close}'?` : "";
        this.error(`Unknown tag '.${ref.tag}'; add it to the legend, e.g. legend { ${ref.tag} "What it means" blue }.${hint}`, ref.loc);
        continue;
      }
      const color = ref.target.style?.color ?? entry.color;
      if (color || entry.dash) ref.target.style = { ...color ? { color } : {}, ...entry.dash ? { dash: entry.dash } : {} };
    }
  }
  /** `"Redirect" 100k rps mix "Cache hit" 90%, "Cache miss" 10%` */
  parseTrafficLine(tokens, line) {
    const [name, rate] = tokens;
    if (name.kind !== "string") {
      this.error('Expected a use case name in quotes and a rate, e.g. "Redirect" 100k rps', this.locOf(name, line));
      return;
    }
    const rps = this.quantityOf(rate, "rps", name, line);
    if (rps === void 0) return;
    const entry = { useCase: name.value, rps, loc: this.lineLoc(tokens, line) };
    let i = 2;
    if (isWord(tokens[i], "peak")) {
      const word = tokens[i];
      const value = tokens[i + 1];
      let peak;
      if (value?.kind === "ident" && MULTIPLIER.test(value.value)) peak = rps * Number(MULTIPLIER.exec(value.value)[1]);
      else if (value?.kind === "const" && value.value.startsWith("x")) {
        const factor = this.countOf(value, line);
        if (factor === void 0) return;
        peak = rps * factor;
      } else if (value?.kind === "quantity" || value?.kind === "number" || isConstUse(value)) peak = this.quantityOf(value, "rps", word, line);
      else {
        this.error(`Expected the peak after peak, as a multiple of the average (peak x3) or a rate (peak 60k rps)${value ? `, not ${describe(value)}` : ""}`, this.locOf(value ?? word, line));
        return;
      }
      if (peak === void 0) return;
      if (peak < rps) {
        this.error(`The peak cannot be below the average, ${rps.toLocaleString("en-US")} rps`, this.locOf(value, line));
        return;
      }
      entry.avgRps = rps;
      entry.rps = Number(peak.toPrecision(12));
      i += 2;
    }
    const shares = [];
    if (tokens[i]) {
      const mix = tokens[i++];
      if (!isWord(mix, "mix")) {
        this.error(`Unexpected ${describe(mix)}; expected mix "Scenario" 90%, "Other" 10%`, this.locOf(mix, line));
        return;
      }
      for (; ; ) {
        const scenario = tokens[i];
        if (scenario?.kind !== "string") {
          this.error('Expected a scenario name in quotes and its share, e.g. "Cache hit" 90%', this.locOf(scenario ?? tokens[i - 1], line));
          return;
        }
        const share2 = this.quantityOf(tokens[i + 1], "%", scenario, line);
        if (share2 === void 0) return;
        const loc = this.locOf(scenario, line);
        if (shares.some((s) => s.scenario === scenario.value)) {
          this.error(`Scenario '${scenario.value}' is in the mix twice`, loc);
          return;
        }
        shares.push({ scenario: scenario.value, share: share2, loc });
        i += 2;
        if (!tokens[i]) break;
        if (tokens[i].kind !== "comma") {
          this.error(`Expected , between mix shares, not ${describe(tokens[i])}`, this.locOf(tokens[i], line));
          return;
        }
        i++;
      }
      const total = shares.reduce((sum, s) => sum + s.share, 0);
      if (total <= 0) {
        this.error("Mix shares must add up to more than 0%", this.locOf(mix, line));
        return;
      }
      if (Math.abs(total - 100) > 1e-9) {
        this.warning(`Mix shares add up to ${Number(total.toFixed(3))}%, not 100%; they are scaled to fit`, this.locOf(mix, line));
      }
      entry.mix = shares.map((s) => ({ scenario: s.scenario, share: s.share / total }));
    }
    const nameLoc = this.locOf(name, line);
    const first = this.traffic.find((t) => t.useCase === entry.useCase);
    if (first) {
      this.error(`Duplicate traffic for '${entry.useCase}' (first ${this.where(first.loc, nameLoc)})`, nameLoc);
      return;
    }
    this.traffic.push(entry);
    this.deferred.push(() => {
      const useCase = this.checkUseCase(entry.useCase, nameLoc);
      if (useCase) for (const s of shares) this.checkScenario(useCase, s.scenario, s.loc);
    });
  }
  /** One line of `requirements { … }`. */
  parseRequirement(tokens, line) {
    const [first] = tokens;
    const loc = this.lineLoc(tokens, line);
    const help = 'Expected a requirement: p99 "Use case" < 50ms, availability >= 99.9%, durable "Use case", survive any node failure, cost <= 3000 usd/month';
    if (first.kind !== "ident") {
      this.error(help, this.locOf(first, line));
      return;
    }
    const word = first.value;
    let i = 1;
    let useCase;
    const readUseCase = () => {
      if (tokens[i]?.kind !== "string") return;
      useCase = { name: tokens[i].value, loc: this.locOf(tokens[i], line) };
      i++;
    };
    const commit = (requirement2, scenario) => {
      this.requirements.push(requirement2);
      const named = useCase;
      if (named)
        this.deferred.push(() => {
          const found = this.checkUseCase(named.name, named.loc);
          if (found && scenario) this.checkScenario(found, scenario.name, scenario.loc);
        });
    };
    const withUseCase = () => useCase ? { useCase: useCase.name } : {};
    if (/^p\d+$/.test(word)) {
      const percentile = PERCENTILES[word];
      if (percentile === void 0) {
        this.error(`Unknown percentile '${word}'; use p50, p90, p95, p99 or p999`, this.locOf(first, line));
        return;
      }
      readUseCase();
      let scenario;
      if (isWord(tokens[i], "scenario")) {
        const name = tokens[i + 1];
        if (!useCase) {
          this.error(`A scenario belongs to a use case; write ${word} "Use case" scenario "Scenario" < 100ms`, this.locOf(tokens[i], line));
          return;
        }
        if (name?.kind !== "string") {
          this.error("Expected a scenario name in quotes after scenario", this.locOf(name ?? tokens[i], line));
          return;
        }
        scenario = { name: name.value, loc: this.locOf(name, line) };
        i += 2;
      }
      if (!this.expectOp(tokens, i, ["<", "<="], `${word} "Use case" < 50ms`, line)) return;
      const maxMs = this.quantityOf(tokens[i + 1], "ms", tokens[i], line);
      if (maxMs === void 0 || !this.expectEnd(tokens, i + 2, line)) return;
      commit({ kind: "latency", percentile, ...withUseCase(), ...scenario ? { scenario: scenario.name } : {}, maxMs, loc }, scenario);
      return;
    }
    switch (word) {
      case "availability": {
        readUseCase();
        if (!this.expectOp(tokens, i, [">=", ">"], 'availability "Use case" >= 99.9%', line)) return;
        const minPercent = this.quantityOf(tokens[i + 1], "%", tokens[i], line);
        if (minPercent === void 0) return;
        if (minPercent > 100) {
          this.error("Availability cannot be more than 100%", this.locOf(tokens[i + 1], line));
          return;
        }
        if (!this.expectEnd(tokens, i + 2, line)) return;
        commit({ kind: "availability", ...withUseCase(), minPercent, loc });
        return;
      }
      case "lag": {
        readUseCase();
        if (!useCase) {
          this.error('Expected a use case name in quotes, e.g. lag "Place order" < 30s', this.locOf(tokens[1] ?? first, line));
          return;
        }
        if (!this.expectOp(tokens, i, ["<", "<="], 'lag "Use case" < 30s', line)) return;
        const maxMs = this.quantityOf(tokens[i + 1], "ms", tokens[i], line);
        if (maxMs === void 0 || !this.expectEnd(tokens, i + 2, line)) return;
        commit({ kind: "lag", useCase: useCase.name, maxMs, loc });
        return;
      }
      case "durable":
        readUseCase();
        if (!useCase) {
          this.error('Expected a use case name in quotes, e.g. durable "Shorten"', this.locOf(tokens[1] ?? first, line));
          return;
        }
        if (!this.expectEnd(tokens, i, line)) return;
        commit({ kind: "durable", useCase: useCase.name, loc });
        return;
      case "survive": {
        if (isWord(tokens[1], "any") && isWord(tokens[2], "node") && isWord(tokens[3], "failure")) {
          if (this.expectEnd(tokens, 4, line)) commit({ kind: "survive", target: "any", loc });
          return;
        }
        if (!isWord(tokens[1], "failure") || !isWord(tokens[2], "of")) {
          this.error("Expected survive any node failure, or survive failure of <node | [Tech] | any kind>", this.locOf(tokens[1] ?? first, line));
          return;
        }
        const target = this.parseSelector(tokens, 3, line);
        if (!target || !this.expectEnd(tokens, target.next, line)) return;
        commit({ kind: "survive", target: target.selector, loc });
        this.checkSelectorLater(target);
        return;
      }
      case "cost": {
        const scoped = this.parseCostScope(tokens, line);
        if (!scoped) return;
        const at = scoped.next;
        if (!this.expectOp(tokens, at, ["<=", "<"], scoped.scope ? "cost @Payments <= 500 usd/month" : "cost <= 3000 usd/month", line)) return;
        const maxUsdPerMonth = this.quantityOf(tokens[at + 1], "usd/month", tokens[at], line);
        if (maxUsdPerMonth === void 0 || !this.expectEnd(tokens, at + 2, line)) return;
        commit({ kind: "cost", maxUsdPerMonth, ...scoped.scope ? { scope: scoped.scope } : {}, loc });
        if (scoped.scope) this.checkCostScope(scoped.scope, this.locOf(tokens[at - 1], line));
        return;
      }
      default:
        this.error(`Unknown requirement '${word}'. ${help}`, this.locOf(first, line));
    }
  }
  /** What follows `cost` before its operator: nothing, `@team`, `.tag` or `group <id>`; the index after it. */
  parseCostScope(tokens, line) {
    const t = tokens[1];
    if (t?.kind === "team") return { scope: { team: t.value }, next: 2 };
    if (t?.kind === "tag") return { scope: { tag: t.value }, next: 2 };
    if (isWord(t, "group")) {
      const id = tokens[2];
      if (id?.kind !== "ident") {
        this.error("Expected a group id after group, e.g. cost group checkout <= 500 usd/month", this.locOf(id ?? t, line));
        return void 0;
      }
      return { scope: { group: id.value }, next: 3 };
    }
    if (t?.kind === "string") {
      const name = t.value.replace(/^@/, "");
      this.error(`A budget names a team as @${name}, a tag as .${name} or a group as group ${name}, without quotes`, this.locOf(t, line));
      return void 0;
    }
    return { next: 1 };
  }
  /** A scoped budget that covers no node is a warning: an unknown team, tag or group. */
  checkCostScope(scope2, loc) {
    this.deferred.push(() => {
      const nodes = [...this.nodes.values()];
      if ("team" in scope2) {
        if (!nodes.some((n) => n.ownerTeam === scope2.team)) this.warning(`No node is owned by @${scope2.team}; give nodes the team with @${scope2.team} after their name`, loc);
      } else if ("tag" in scope2) {
        if (!nodes.some((n) => n.tag === scope2.tag)) this.warning(`No node or group has the tag .${scope2.tag}`, loc);
      } else {
        const group = this.nodes.get(scope2.group);
        if (!group) this.warning(`Unknown group '${scope2.group}'`, loc);
        else if (group.kind !== "group") this.warning(`'${scope2.group}' is not a group; a budget covers a team (@team), a tag (.tag) or a group (group <id>)`, loc);
      }
    });
  }
  /** `db 20k rps latency 4ms availability 99.95% cost 400 usd/month durable`, parts in any order. */
  parseCapacityLine(tokens, line) {
    const [id] = tokens;
    if (id.kind !== "ident") {
      this.error("Expected a node id and its overrides, e.g. db 20k rps latency 4ms", this.locOf(id, line));
      return;
    }
    const override = { node: id.value, loc: this.lineLoc(tokens, line) };
    const seen = /* @__PURE__ */ new Set();
    let hitLoc;
    let drainLoc;
    for (let i = 1; i < tokens.length; ) {
      const t = tokens[i];
      let part;
      if (t.kind === "quantity" || t.kind === "number" || isConstUse(t)) {
        part = "rate";
        const rps = this.quantityOf(t, "rps", t, line);
        if (rps === void 0) return;
        override.rps = rps;
        i++;
      } else if (isWord(t, "latency") || isWord(t, "availability") || isWord(t, "cost") || isWord(t, "timeout")) {
        part = t.value;
        const unit = part === "latency" || part === "timeout" ? "ms" : part === "availability" ? "%" : "usd/month";
        const value = this.quantityOf(tokens[i + 1], unit, t, line);
        if (value === void 0) return;
        if (part === "latency") override.latencyMs = value;
        else if (part === "timeout") override.timeoutMs = value;
        else if (part === "availability") override.availability = value;
        else override.costUsd = value;
        i += 2;
      } else if (isWord(t, "hit")) {
        part = "hit";
        const value = this.quantityOf(tokens[i + 1], "%", t, line);
        if (value === void 0) return;
        if (value > 100) {
          this.error("A hit rate cannot be more than 100%", this.locOf(tokens[i + 1], line));
          return;
        }
        override.hitPercent = value;
        hitLoc = this.locOf(t, line);
        i += 2;
      } else if (isWord(t, "errors")) {
        part = "errors";
        const value = this.quantityOf(tokens[i + 1], "%", t, line);
        if (value === void 0) return;
        if (value > 100) {
          this.error("An error rate cannot be more than 100%", this.locOf(tokens[i + 1], line));
          return;
        }
        override.errorPercent = value;
        i += 2;
      } else if (isWord(t, "drain")) {
        part = "drain";
        const value = this.quantityOf(tokens[i + 1], "rps", t, line);
        if (value === void 0) return;
        override.drainRps = value;
        drainLoc = this.locOf(t, line);
        i += 2;
      } else if (isWord(t, "retries")) {
        part = "retries";
        const n = tokens[i + 1];
        const retries = isConstUse(n) ? this.countOf(n, line) : n?.kind === "number" ? Number(n.value) : NaN;
        if (retries === void 0) return;
        if (!Number.isInteger(retries) || retries < 0 || retries > MAX_RETRIES) {
          this.error(`Expected a whole number of retries from 0 to ${MAX_RETRIES}, e.g. retries 3`, this.locOf(n ?? t, line));
          return;
        }
        override.retries = retries;
        i += 2;
      } else if (isWord(t, "durable") || isWord(t, "volatile")) {
        part = "durable or volatile";
        override.durable = t.value === "durable";
        i++;
      } else if (isWord(t, "reads") || isWord(t, "writes")) {
        part = t.value;
        const value = this.quantityOf(tokens[i + 1], "rps", t, line);
        if (value === void 0) return;
        if (part === "reads") override.readRps = value;
        else override.writeRps = value;
        i += 2;
      } else if (isWord(t, "shards")) {
        part = "shards";
        const n = tokens[i + 1];
        const shards = isConstUse(n) ? this.countOf(n, line) : n?.kind === "number" ? Number(n.value) : NaN;
        if (shards === void 0) return;
        if (!Number.isInteger(shards) || shards < 1) {
          this.error("Expected a whole number of shards, at least 1, e.g. shards 4", this.locOf(n ?? t, line));
          return;
        }
        override.shards = shards;
        i += 2;
      } else if (isWord(t, "size")) {
        part = "size";
        const value = tokens[i + 1];
        if (!isWord(value, "S") && !isWord(value, "M") && !isWord(value, "L")) {
          this.error(`Expected S, M or L after size${value ? `, not ${describe(value)}` : ""}`, this.locOf(value ?? t, line));
          return;
        }
        override.size = value.value;
        i += 2;
      } else if (isWord(t, "consistency")) {
        part = "consistency";
        const value = tokens[i + 1];
        if (!isWord(value, "strong") && !isWord(value, "eventual")) {
          this.error(`Expected strong or eventual after consistency${value ? `, not ${describe(value)}` : ""}`, this.locOf(value ?? t, line));
          return;
        }
        override.consistency = value.value;
        i += 2;
      } else if (isWord(t, "bandwidth") || isWord(t, "egress")) {
        part = t.value;
        const value = this.quantityOf(tokens[i + 1], part === "bandwidth" ? "MBps" : "usd/GB", t, line);
        if (value === void 0) return;
        if (part === "bandwidth") {
          if (value <= 0) {
            this.error("Bandwidth must be more than 0", this.locOf(tokens[i + 1], line));
            return;
          }
          override.bandwidthMBps = value;
        } else override.egressUsdPerGb = value;
        i += 2;
      } else {
        this.error(`Unexpected ${describe(t)}; expected ${CAPACITY_PARTS}`, this.locOf(t, line));
        return;
      }
      const clash = part === "rate" ? ["reads", "writes"].find((p) => seen.has(p)) : part === "reads" || part === "writes" ? seen.has("rate") ? part : void 0 : void 0;
      if (clash) {
        this.error(`A rate sets both reads and writes; give either a rate or reads and writes for '${id.value}'`, this.locOf(t, line));
        return;
      }
      if (seen.has(part)) {
        this.error(`${part[0].toUpperCase()}${part.slice(1)} is given twice for '${id.value}'`, this.locOf(t, line));
        return;
      }
      seen.add(part);
    }
    const idLoc = this.locOf(id, line);
    if (seen.size === 0) {
      this.warning(`Capacity line for '${id.value}' overrides nothing; add ${CAPACITY_PARTS}`, idLoc);
      return;
    }
    const first = this.capacity.find((c) => c.node === id.value);
    if (first) {
      this.error(`Duplicate capacity for '${id.value}' (first ${this.where(first.loc, idLoc)})`, idLoc);
      return;
    }
    this.capacity.push(override);
    this.deferred.push(() => {
      const node = this.nodes.get(id.value);
      if (!node) {
        this.warning(`Unknown node '${id.value}' in capacity`, idLoc);
        return;
      }
      const storeOnly = ["shards", "consistency"].filter((p) => seen.has(p));
      if (storeOnly.length && !isDataStore(kindOf(node)))
        this.warning(`'${id.value}' is not a data store (${DATA_STORE_KINDS.join(", ")}); ${storeOnly.join(" and ")} only apply to data stores`, idLoc);
      if (hitLoc) this.checkHitRate(node, override.hitPercent, hitLoc);
      if (drainLoc && !["queue", "broker"].includes(kindOf(node))) this.warning(`'${id.value}' is not a queue or broker; a drain rate only means something for one`, drainLoc);
    });
  }
  /**
   * A hit rate on something that is not a cache is a warning. A use case
   * whose traffic `mix` splits it into scenarios already models hits and
   * misses itself: the mix applies to it, and an info says so.
   */
  checkHitRate(node, percent, loc) {
    const kind = kindOf(node);
    if (kind !== "cache" && kind !== "cdn") this.warning(`'${node.id}' is not a cache or CDN; a hit rate only means something for one`, loc);
    for (const entry of this.traffic) {
      if (!entry.mix?.length) continue;
      const useCase = this.built.find((u) => u.name === entry.useCase);
      if (!useCase?.scenarios.some((s) => s.steps.some((step) => step.toServiceId === node.id))) continue;
      this.info(`"${useCase.name}" splits its traffic into scenarios with mix, so its mix decides the hits and misses of '${node.id}', not the ${percent}% hit rate`, loc);
    }
  }
  /** `entity Url [in db] ["description"] {` */
  parseEntity(tokens, line) {
    const name = tokens[1];
    let i = 2;
    let store;
    if (isWord(tokens[i], "in")) {
      const id = tokens[i + 1];
      if (id?.kind !== "ident") {
        this.error("Expected the id of the node that stores the entity after in, e.g. entity Url in db {", this.locOf(id ?? tokens[i], line));
        this.skipSection("entity", tokens, line);
        return;
      }
      store = { id: id.value, loc: this.locOf(id, line) };
      i += 2;
    }
    const description = tokens[i]?.kind === "string" ? tokens[i++].value : void 0;
    if (tokens[i]?.kind !== "lbrace") {
      this.error('Expected { after the entity header, e.g. entity Url in db "Short codes" {', this.locOf(tokens[i] ?? tokens[i - 1], line));
      this.skipSection("entity", tokens, line);
      return;
    }
    this.expectEnd(tokens, i + 1, line);
    const loc = this.locOf(name, line);
    const entity = { name: name.value, ...store ? { store: store.id } : {}, ...description !== void 0 ? { description } : {}, fields: [], loc };
    const first = this.entities.find((e) => e.name === entity.name);
    if (first) {
      this.error(`Duplicate entity '${entity.name}' (first ${this.where(first.loc, loc)})`, loc);
      this.skipSection("entity", tokens, line);
      return;
    }
    if (!this.openSection("entity", tokens, line, { entity })) return;
    this.entities.push(entity);
    if (store) {
      const { id, loc: storeLoc } = store;
      this.deferred.push(() => {
        const node = this.nodes.get(id);
        if (!node) this.warning(`Unknown node '${id}'`, storeLoc);
        else if (!isDataStore(kindOf(node)))
          this.warning(`'${id}' is not a data store (${DATA_STORE_KINDS.join(", ")}); entity '${entity.name}' is placed in a ${kindOf(node)}`, storeLoc);
      });
    }
  }
  /** `code string key`: a field name, a type and flags. */
  parseField(entity, tokens, line) {
    const [name, type] = tokens;
    if (name.kind !== "ident") {
      this.error("Expected a field: name type [key] [index] [unique] [optional], e.g. code string key", this.locOf(name, line));
      return;
    }
    if (type?.kind !== "ident") {
      this.error(`Expected a type after '${name.value}', e.g. ${name.value} string`, this.locOf(type ?? name, line));
      return;
    }
    const flags = [];
    for (const t of tokens.slice(2)) {
      if (t.kind !== "ident" || !FIELD_FLAGS.includes(t.value)) {
        this.error(`Unknown field flag ${describe(t)}; use key, index, unique or optional`, this.locOf(t, line));
        return;
      }
      if (flags.includes(t.value)) {
        this.error(`Flag '${t.value}' is given twice`, this.locOf(t, line));
        return;
      }
      flags.push(t.value);
    }
    if (entity.fields.some((f) => f.name === name.value)) {
      this.error(`Duplicate field '${name.value}' in entity '${entity.name}'`, this.locOf(name, line));
      return;
    }
    entity.fields.push({ name: name.value, type: type.value, flags });
  }
  /** `decision "Title" because "Reason"`, or `decision "Title" {` with because / rejected lines. */
  parseDecision(tokens, line) {
    const title = tokens[1];
    const decision = { title: title.value, rejected: [], loc: this.locOf(title, line) };
    const third = tokens[2];
    if (third.kind === "lbrace") {
      this.expectEnd(tokens, 3, line);
      if (this.openSection("decision", tokens, line, { decision })) this.decisions.push(decision);
      return;
    }
    if (!isWord(third, "because")) {
      this.error(`Expected because "reason" or { after the decision title, not ${describe(third)}`, this.locOf(third, line));
      this.skipSection("decision", tokens, line);
      return;
    }
    if (this.stack.length > 0) {
      this.error("decision is only allowed at the top level", this.locOf(tokens[0], line));
      return;
    }
    const reason = tokens[3];
    if (reason?.kind !== "string") {
      this.error("Expected the reason in quotes after because", this.locOf(reason ?? third, line));
      return;
    }
    if (!this.expectEnd(tokens, 4, line)) return;
    decision.because = reason.value;
    this.decisions.push(decision);
  }
  parseDecisionLine(decision, tokens, line) {
    const [word] = tokens;
    if (isWord(word, "because")) {
      if (tokens[1]?.kind !== "string") {
        this.error("Expected the reason in quotes after because", this.locOf(tokens[1] ?? word, line));
        return;
      }
      if (decision.because !== void 0) {
        this.error('A decision has one because; list the other options with rejected "option" "reason"', this.locOf(word, line));
        return;
      }
      if (this.expectEnd(tokens, 2, line)) decision.because = tokens[1].value;
      return;
    }
    if (isWord(word, "rejected")) {
      const [, option, reason] = tokens;
      if (option?.kind !== "string" || reason?.kind !== "string") {
        const bad = option?.kind !== "string" ? option : reason;
        this.error('Expected rejected "option" "reason"', this.locOf(bad ?? tokens[tokens.length - 1], line));
        return;
      }
      if (this.expectEnd(tokens, 3, line)) decision.rejected.push({ option: option.value, reason: reason.value });
      return;
    }
    this.error('Expected because "reason" or rejected "option" "reason"', this.locOf(word, line));
  }
  /** `test "Name" {` */
  parseTest(tokens, line) {
    const name = tokens[1];
    const loc = this.locOf(name, line);
    if (tokens[2].kind !== "lbrace") {
      this.error(`Expected { after the test name, not ${describe(tokens[2])}`, this.locOf(tokens[2], line));
      this.skipSection("test", tokens, line);
      return;
    }
    this.expectEnd(tokens, 3, line);
    const first = this.tests.find((t) => t.name === name.value);
    if (first) {
      this.error(`Duplicate test '${name.value}' (first ${this.where(first.loc, loc)})`, loc);
      this.skipSection("test", tokens, line);
      return;
    }
    const test = { name: name.value, assertions: [], loc };
    if (this.openSection("test", tokens, line, { test })) this.tests.push(test);
  }
  /** `whatif "Name" {` */
  parseWhatIf(tokens, line) {
    const name = tokens[1];
    const loc = this.locOf(name, line);
    if (tokens[2].kind !== "lbrace") {
      this.error(`Expected { after the what-if name, not ${describe(tokens[2])}`, this.locOf(tokens[2], line));
      this.skipSection("whatif", tokens, line);
      return;
    }
    this.expectEnd(tokens, 3, line);
    const first = this.whatifs.find((w) => w.name === name.value);
    if (first) {
      this.error(`Duplicate what-if '${name.value}' (first ${this.where(first.loc, loc)})`, loc);
      this.skipSection("whatif", tokens, line);
      return;
    }
    const whatif = { name: name.value, changes: [], loc };
    if (this.openSection("whatif", tokens, line, { whatif })) this.whatifs.push(whatif);
  }
  /** One line of a what-if: `traffic "Use case" x3`, `traffic "Use case" 50k rps`, `fail <node>` or `<node> x4`. */
  parseWhatIfLine(whatif, tokens, line) {
    const [first, second, third] = tokens;
    const loc = this.lineLoc(tokens, line);
    const help = 'Expected a what-if change: traffic "Use case" x3, traffic "Use case" 50k rps, fail <node>, <node> x4, <node> hit 40% or <node> errors 20%';
    const checkNode = (id) => {
      const idLoc = this.locOf(id, line);
      this.deferred.push(() => {
        if (!this.nodes.has(id.value)) this.warning(`Unknown node '${id.value}' in what-if`, idLoc);
      });
    };
    if (first.kind === "ident" && (second?.kind === "ident" && REPLICAS.test(second.value) || second?.kind === "const")) {
      if (!this.expectEnd(tokens, 2, line)) return;
      const replicas = second.kind === "const" ? this.replicasOf(second, line, "A what-if needs a whole number of replicas, at least x1; to take a node down, write fail <node>") : Number(REPLICAS.exec(second.value)[1]);
      if (replicas === void 0) return;
      if (replicas < 1) {
        this.error("A what-if needs at least one replica, x1; to take a node down, write fail <node>", this.locOf(second, line));
        return;
      }
      if (whatif.changes.some((c) => c.kind === "replicas" && c.node === first.value)) {
        this.error(`Replicas of '${first.value}' are set twice in this what-if`, this.locOf(first, line));
        return;
      }
      checkNode(first);
      whatif.changes.push({ kind: "replicas", node: first.value, replicas, loc });
      return;
    }
    if (first.kind === "ident" && second?.kind === "ident" && MULTIPLIER.test(second.value)) {
      this.error(`Replicas are a whole number, e.g. ${first.value} x4`, this.locOf(second, line));
      return;
    }
    if (first.kind === "ident" && isWord(second, "hit") && tokens.length > 2) {
      const percent = this.quantityOf(third, "%", second, line);
      if (percent === void 0 || !this.expectEnd(tokens, 3, line)) return;
      if (percent > 100) {
        this.error("A hit rate cannot be more than 100%", this.locOf(third, line));
        return;
      }
      if (whatif.changes.some((c) => c.kind === "hit" && c.node === first.value)) {
        this.error(`The hit rate of '${first.value}' is set twice in this what-if`, this.locOf(first, line));
        return;
      }
      checkNode(first);
      whatif.changes.push({ kind: "hit", node: first.value, percent, loc });
      return;
    }
    if (first.kind === "ident" && isWord(second, "errors") && tokens.length > 2) {
      const percent = this.quantityOf(third, "%", second, line);
      if (percent === void 0 || !this.expectEnd(tokens, 3, line)) return;
      if (percent > 100) {
        this.error("An error rate cannot be more than 100%", this.locOf(third, line));
        return;
      }
      if (whatif.changes.some((c) => c.kind === "errors" && c.node === first.value)) {
        this.error(`The error rate of '${first.value}' is set twice in this what-if`, this.locOf(first, line));
        return;
      }
      checkNode(first);
      whatif.changes.push({ kind: "errors", node: first.value, percent, loc });
      return;
    }
    if (isWord(first, "fail")) {
      if (second?.kind !== "ident") {
        this.error("Expected the node that fails, e.g. fail cache", this.locOf(second ?? first, line));
        return;
      }
      if (!this.expectEnd(tokens, 2, line)) return;
      if (whatif.changes.some((c) => c.kind === "fail" && c.node === second.value)) {
        this.error(`'${second.value}' fails twice in this what-if`, this.locOf(second, line));
        return;
      }
      checkNode(second);
      whatif.changes.push({ kind: "fail", node: second.value, loc });
      return;
    }
    if (isWord(first, "traffic")) {
      if (second?.kind !== "string") {
        this.error('Expected a use case name in quotes, e.g. traffic "Checkout" x3 or traffic "Checkout" 50k rps', this.locOf(second ?? first, line));
        return;
      }
      let change;
      if (third?.kind === "ident" && MULTIPLIER.test(third.value)) {
        const multiply = Number(MULTIPLIER.exec(third.value)[1]);
        change = { kind: "traffic", useCase: second.value, multiply, loc };
      } else if (third?.kind === "const" && third.value.startsWith("x")) {
        const multiply = this.countOf(third, line);
        if (multiply === void 0) return;
        change = { kind: "traffic", useCase: second.value, multiply, loc };
      } else {
        const rps = this.quantityOf(third, "rps", second, line);
        if (rps === void 0) return;
        change = { kind: "traffic", useCase: second.value, rps, loc };
      }
      if (!this.expectEnd(tokens, 3, line)) return;
      if (whatif.changes.some((c) => c.kind === "traffic" && c.useCase === second.value)) {
        this.error(`Traffic of '${second.value}' is changed twice in this what-if`, this.locOf(second, line));
        return;
      }
      const nameLoc = this.locOf(second, line);
      this.deferred.push(() => this.checkUseCase(second.value, nameLoc));
      whatif.changes.push(change);
      return;
    }
    this.error(help, this.locOf(first, line));
  }
  /** One assertion line of a test (docs/design/hld-and-practice.md §1.9). */
  parseAssertion(tokens, line) {
    const loc = this.lineLoc(tokens, line);
    const [first] = tokens;
    const selectors = [];
    const selector = (i2) => {
      const s = this.parseSelector(tokens, i2, line);
      if (s) selectors.push(s);
      return s;
    };
    const done = (assertion3, end) => {
      if (!this.expectEnd(tokens, end, line)) return void 0;
      selectors.forEach((s) => this.checkSelectorLater(s));
      return assertion3;
    };
    const expectWords = (i2, words, example) => {
      for (const [k, w] of words.entries()) {
        if (!isWord(tokens[i2 + k], w)) {
          this.error(`Expected '${w}' here, e.g. ${example}`, this.locOf(tokens[i2 + k] ?? tokens[tokens.length - 1], line));
          return false;
        }
      }
      return true;
    };
    if (isWord(first, "no") && isWord(tokens[1], "path")) {
      const example = "no path from client to any database";
      if (!expectWords(2, ["from"], example)) return;
      const from = selector(3);
      if (!from || !expectWords(from.next, ["to"], example)) return;
      const to = selector(from.next + 1);
      if (!to) return;
      return done({ kind: "noPath", from: from.selector, to: to.selector, loc }, to.next);
    }
    if (first.kind !== "string") {
      if (first.kind !== "ident" && first.kind !== "tech") {
        this.error(ASSERTION_HELP, this.locOf(first, line));
        return;
      }
      const inUseCase = isWord(first, "in") && tokens[1]?.kind === "string" ? { name: tokens[1].value, loc: this.locOf(tokens[1], line) } : void 0;
      const target = selector(inUseCase ? 2 : 0);
      if (!target) return;
      const word = tokens[target.next];
      if (isWord(word, "calls") || isWord(word, "never")) {
        const never = word.value === "never";
        if (never && !expectWords(target.next + 1, ["calls"], "any service never calls any storage")) return;
        const to = selector(target.next + (never ? 2 : 1));
        if (!to) return;
        const assertion3 = done(
          { kind: "senderCalls", ...inUseCase ? { useCase: inUseCase.name } : {}, from: target.selector, to: to.selector, quantifier: never ? "never" : "some", loc },
          to.next
        );
        if (assertion3 && inUseCase) this.deferred.push(() => this.checkUseCase(inUseCase.name, inUseCase.loc));
        return assertion3;
      }
      if (inUseCase) {
        this.error(`Expected calls or never calls here, e.g. in "${inUseCase.name}" api calls db`, this.locOf(word ?? tokens[tokens.length - 1], line));
        return;
      }
      if (!isWord(word, "has")) {
        this.error(ASSERTION_HELP, this.locOf(word ?? first, line));
        return;
      }
      const i2 = target.next + 1;
      const example = "api has replicas >= 2";
      if (!expectWords(i2, ["replicas"], example) || !this.expectOp(tokens, i2 + 1, [">="], example, line)) return;
      const n = tokens[i2 + 2];
      if (n?.kind !== "number" || Number(n.value) < 1) {
        this.error("Expected a whole number of replicas, at least 1", this.locOf(n ?? tokens[i2 + 1], line));
        return;
      }
      return done({ kind: "replicas", target: target.selector, min: Number(n.value), loc }, i2 + 3);
    }
    const useCase = first.value;
    const useCaseLoc = this.locOf(first, line);
    let i = 1;
    let scenario;
    if (isWord(tokens[i], "scenario")) {
      const s = tokens[i + 1];
      if (s?.kind !== "string") {
        this.error("Expected a scenario name in quotes after scenario", this.locOf(s ?? tokens[i], line));
        return;
      }
      scenario = { name: s.value, loc: this.locOf(s, line) };
      i += 2;
    }
    const withScenario = scenario ? { scenario: scenario.name } : {};
    const verb = tokens[i];
    const wholeUseCase = (what) => {
      if (!scenario) return true;
      this.error(`${what} is about the whole use case; leave out scenario "\u2026"`, scenario.loc);
      return false;
    };
    const call = (j) => {
      const word = tokens[j];
      const nameAt = (k, what, example2) => {
        const t = tokens[k];
        if (t?.kind === "ident" || t?.kind === "string") return t.value;
        this.error(`Expected ${what} here, e.g. ${example2}`, this.locOf(t ?? tokens[tokens.length - 1], line));
        return void 0;
      };
      if (isWord(word, "uses")) {
        const example2 = `"${useCase}" uses INSERT on db`;
        const op = nameAt(j + 1, "an operation", example2);
        if (op === void 0 || !expectWords(j + 2, ["on"], example2)) return;
        const target2 = selector(j + 3);
        return target2 && { target: target2, match: { op }, next: target2.next };
      }
      if (isWord(word, "sends")) {
        const example2 = `"${useCase}" sends header Authorization to api`;
        if (!expectWords(j + 1, ["header"], example2)) return;
        const header = nameAt(j + 2, "a header name", example2);
        if (header === void 0 || !expectWords(j + 3, ["to"], example2)) return;
        const target2 = selector(j + 4);
        return target2 && { target: target2, match: { header }, next: target2.next };
      }
      if (!isWord(word, "calls")) {
        this.error(`Expected calls, uses or sends header here, e.g. "${useCase}" never calls any database`, this.locOf(word ?? tokens[tokens.length - 1], line));
        return;
      }
      const target = selector(j + 1);
      if (!target) return;
      if (!isWord(tokens[target.next], "with")) return { target, next: target.next };
      const [method, path] = [tokens[target.next + 1], tokens[target.next + 2]];
      const example = `"${useCase}" calls api with GET /urls/{code}`;
      if (method?.kind !== "ident" || !HTTP_METHODS.includes(method.value.toUpperCase())) {
        this.error(`Expected an HTTP method after with (${HTTP_METHODS.join(", ")}), e.g. ${example}`, this.locOf(method ?? tokens[target.next], line));
        return;
      }
      if (path?.kind !== "path") {
        this.error(`Expected a path starting with / after ${method.value}, e.g. ${example}`, this.locOf(path ?? method, line));
        return;
      }
      return { target, match: { method: method.value.toUpperCase(), path: path.value }, next: target.next + 3 };
    };
    const matchOf = (c) => c.match ? { match: c.match } : {};
    let assertion2;
    if (isWord(verb, "calls") || isWord(verb, "uses") || isWord(verb, "sends")) {
      const c = call(i);
      if (!c) return;
      const word = tokens[c.next];
      if (isWord(word, "before") && isWord(tokens[c.next + 1], "responding")) {
        assertion2 = done({ kind: "beforeResponding", useCase, ...withScenario, target: c.target.selector, match: c.match ?? {}, loc }, c.next + 2);
      } else if (isWord(word, "before")) {
        const then = selector(c.next + 1);
        if (!then) return;
        assertion2 = done({ kind: "before", useCase, ...withScenario, first: c.target.selector, ...matchOf(c), then: then.selector, loc }, then.next);
      } else if (isWord(word, "after")) {
        const after2 = selector(c.next + 1);
        if (!after2) return;
        assertion2 = done({ kind: "after", useCase, ...withScenario, target: c.target.selector, ...matchOf(c), after: after2.selector, loc }, after2.next);
      } else {
        assertion2 = done({ kind: "calls", useCase, ...withScenario, target: c.target.selector, ...matchOf(c), quantifier: "some", loc }, c.next);
      }
    } else if (isWord(verb, "every")) {
      if (!expectWords(i + 1, ["scenario"], `"${useCase}" every scenario calls any cache`)) return;
      const c = call(i + 2);
      if (!c) return;
      assertion2 = done({ kind: "calls", useCase, ...withScenario, target: c.target.selector, ...matchOf(c), quantifier: "every", loc }, c.next);
    } else if (isWord(verb, "never") && isWord(tokens[i + 1], "waits")) {
      if (!expectWords(i + 2, ["for"], `"${useCase}" never waits for any queue`)) return;
      const target = selector(i + 3);
      if (!target) return;
      assertion2 = done({ kind: "neverWaits", useCase, ...withScenario, target: target.selector, loc }, target.next);
    } else if (isWord(verb, "starts")) {
      if (!wholeUseCase("starts at") || !expectWords(i + 1, ["at"], `"${useCase}" starts at any queue`)) return;
      const target = selector(i + 2);
      if (!target) return;
      assertion2 = done({ kind: "startsAt", useCase, target: target.selector, loc }, target.next);
    } else if (isWord(verb, "never")) {
      const c = call(i + 1);
      if (!c) return;
      assertion2 = done({ kind: "calls", useCase, ...withScenario, target: c.target.selector, ...matchOf(c), quantifier: "never", loc }, c.next);
    } else if (isWord(verb, "writes")) {
      const target = selector(i + 1);
      if (!target || !expectWords(target.next, ["before", "responding"], `"${useCase}" writes db before responding`)) return;
      assertion2 = done({ kind: "writesBeforeResponding", useCase, ...withScenario, target: target.selector, loc }, target.next + 2);
    } else if (isWord(verb, "responds")) {
      const status = tokens[i + 1];
      if (!status || status.kind !== "number" && status.kind !== "quantity" || !/^[1-5](\d\d|xx)$/.test(status.value)) {
        this.error("Expected a status code or class after responds, e.g. 201 or 4xx", this.locOf(status ?? verb, line));
        return;
      }
      assertion2 = done({ kind: "responds", useCase, ...withScenario, status: status.value, loc }, i + 2);
    } else if (isWord(verb, "has")) {
      if (!wholeUseCase("has scenario") || !expectWords(i + 1, ["scenario"], `"${useCase}" has scenario "Not found"`)) return;
      const name = tokens[i + 2];
      if (name?.kind !== "string") {
        this.error("Expected a scenario name in quotes after has scenario", this.locOf(name ?? tokens[i + 1], line));
        return;
      }
      assertion2 = done({ kind: "hasScenario", useCase, scenario: name.value, loc }, i + 3);
    } else if (isWord(verb, "handles")) {
      if (!wholeUseCase("handles failure") || !expectWords(i + 1, ["failure", "of"], `"${useCase}" handles failure of cache`)) return;
      const target = selector(i + 3);
      if (!target) return;
      assertion2 = done({ kind: "handlesFailure", useCase, target: target.selector, loc }, target.next);
    } else {
      this.error(`Expected ${ASSERTION_VERBS} after "${useCase}"`, this.locOf(verb ?? first, line));
      return;
    }
    if (assertion2) {
      this.deferred.push(() => {
        const found = this.checkUseCase(useCase, useCaseLoc);
        if (found && scenario) this.checkScenario(found, scenario.name, scenario.loc);
      });
    }
    return assertion2;
  }
  /** A selector starting at `tokens[i]`: one or more of node id, `[Tech]`, `any <kind>`, `any strong store`, joined by `or`. */
  parseSelector(tokens, i, line) {
    const atoms = [];
    let next = i;
    for (; ; ) {
      const atom2 = this.parseSelectorAtom(tokens, next, line);
      if (!atom2) return void 0;
      atoms.push(atom2);
      next = atom2.next;
      if (!isWord(tokens[next], "or")) break;
      next++;
    }
    const selector = atoms.length === 1 ? atoms[0].selector : { anyOf: atoms.map((a) => a.selector) };
    return { selector, next, atoms };
  }
  /** One node id, `[Tech]`, `any <kind>` or `any strong|eventual store` at `tokens[i]`. */
  parseSelectorAtom(tokens, i, line) {
    const t = tokens[i];
    if (t?.kind === "tech") {
      const tech = findTech(t.value)?.techStack ?? t.value;
      return { selector: { tech }, next: i + 1, token: t, loc: this.locOf(t, line) };
    }
    if (isWord(t, "any")) {
      const kind = tokens[i + 1];
      if (isWord(kind, "strong") || isWord(kind, "eventual")) {
        if (!isWord(tokens[i + 2], "store")) {
          this.error(`Expected 'store' here, e.g. any ${kind.value} store`, this.locOf(tokens[i + 2] ?? kind, line));
          return void 0;
        }
        return { selector: { consistency: kind.value }, next: i + 3, token: t, loc: this.locOf(t, line) };
      }
      if (kind?.kind !== "ident" || !isKind(kind.value)) {
        this.error(`Expected a kind after any: ${KINDS.join(", ")}, or strong store / eventual store`, this.locOf(kind ?? t, line));
        return void 0;
      }
      return { selector: { kind: kind.value }, next: i + 2, token: t, loc: this.locOf(t, line) };
    }
    if (t?.kind === "ident") return { selector: { node: t.value }, next: i + 1, token: t, loc: this.locOf(t, line) };
    this.error(`Expected a node id, [Tech] or any <kind>${t ? `, not ${describe(t)}` : ""}`, this.locOf(t ?? tokens[tokens.length - 1], line));
    return void 0;
  }
  /** Warns about a selector naming a tech stack that does not exist, and (once every file is read) a node that does not. */
  checkSelectorLater({ atoms }) {
    for (const { selector, token, loc } of atoms) {
      if ("tech" in selector && !findTech(token.value)) {
        this.deferred.push(() => {
          if (lookupType(this.typeTable, token.value)) return;
          const suggestion = suggestTech(token.value);
          this.warning(`Unknown tech stack '${token.value}'${suggestion ? `. Did you mean '${suggestion}'?` : ""}`, loc);
        });
      }
      if ("node" in selector) {
        this.deferred.push(() => {
          if (!this.nodes.has(selector.node)) this.warning(`Unknown node '${selector.node}'`, loc);
        });
      }
    }
  }
  checkUseCase(name, loc) {
    const useCase = this.built.find((u) => u.name === name);
    if (!useCase) this.warning(`Unknown use case '${name}'`, loc);
    return useCase;
  }
  checkScenario(useCase, name, loc) {
    if (useCase.scenarios.some((s) => s.name === name)) return;
    const names = useCase.scenarios.map((s) => `'${s.name}'`).join(", ");
    this.warning(`Use case '${useCase.name}' has no scenario '${name}'; its scenarios are ${names}`, loc);
  }
  /** The value of a quantity token in `unit`, or undefined after reporting what is wrong. `after` locates a missing token. */
  quantityOf(token, unit, after2, line) {
    const expected = UNIT_EXAMPLES[unit];
    if (isConstUse(token)) {
      const c = this.constantOf(token, line);
      if (!c) return void 0;
      if (c.unit !== unit) {
        this.error(`'${token.value}' is ${c.text}, ${kindName(c.unit)}; expected ${expected}`, this.locOf(token, line));
        return void 0;
      }
      return c.value;
    }
    if (token?.kind !== "quantity" && token?.kind !== "number") {
      this.error(`Expected ${expected}${token ? `, not ${describe(token)}` : ""}`, this.locOf(token ?? after2, line));
      return void 0;
    }
    const loc = this.locOf(token, line);
    const written = this.lines[line - 1].slice(token.col - 1, token.col - 1 + token.length);
    const q = parseQuantity(written);
    if ("error" in q) {
      this.error(q.error, loc);
      return void 0;
    }
    if (q.unit !== unit) {
      this.error(q.unit ? `Expected ${expected}, not '${written}'` : `'${written}' needs a unit: expected ${expected}`, loc);
      return void 0;
    }
    return q.value;
  }
  /** `let name = value`, read before the rest of its file. */
  defineConstant(tokens, line) {
    const [, name, eq, value] = tokens;
    if (value?.kind !== "quantity" && value?.kind !== "number") {
      this.error(`Expected a number or quantity after =, e.g. let ${name.value} = 120k rps${value ? `, not ${describe(value)}` : ""}`, this.locOf(value ?? eq, line));
      return;
    }
    if (!this.expectEnd(tokens, 4, line)) return;
    const text = this.lines[line - 1].slice(value.col - 1, value.col - 1 + value.length);
    const q = parseQuantity(text);
    if ("error" in q) {
      this.error(q.error, this.locOf(value, line));
      return;
    }
    const loc = this.locOf(name, line);
    const first = this.constants.get(name.value);
    if (first) {
      this.error(`Constant '${name.value}' is defined twice (first ${this.where(first.loc, loc)})`, loc);
      return;
    }
    this.constants.set(name.value, { name: name.value, value: q.value, ...q.unit ? { unit: q.unit } : {}, text: text.replace(/[ \t]+/g, " "), loc });
  }
  /** The constant `$name` or `x$name` names, or undefined after reporting that there is none. */
  constantOf(token, line) {
    const name = token.value.replace(/^x?\$/, "");
    const found = this.constants.get(name);
    if (found) return found;
    const near = [...this.constants.keys()].find((k) => editDistance2(k, name) <= 2);
    this.error(`Unknown constant '$${name}'${near ? `; did you mean '$${near}'?` : `; define it with let ${name} = \u2026`}`, this.locOf(token, line));
    return void 0;
  }
  /** The value of a constant used as a count (`x$n`, `shards $n`): a plain number. */
  countOf(token, line) {
    const c = this.constantOf(token, line);
    if (!c) return void 0;
    if (c.unit !== void 0) {
      this.error(`'${token.value}' needs a plain number, as in let ${c.name} = 3; '$${c.name}' is ${c.text}, ${kindName(c.unit)}`, this.locOf(token, line));
      return void 0;
    }
    return c.value;
  }
  /** `x$n` after a node: its replicas, a whole number of at least 1. */
  replicasOf(token, line, wrong) {
    if (!token.value.startsWith("x")) {
      this.error(`Write x${token.value} for replicas`, this.locOf(token, line));
      return void 0;
    }
    const n = this.countOf(token, line);
    if (n === void 0) return void 0;
    if (!Number.isInteger(n) || n < 1) {
      this.error(`${wrong} ('${token.value}' is ${n})`, this.locOf(token, line));
      return void 0;
    }
    return n;
  }
  expectOp(tokens, i, ops, example, line) {
    const t = tokens[i];
    if (t?.kind === "op" && ops.includes(t.value)) return true;
    this.error(`Expected ${ops[0]} here, e.g. ${example}`, this.locOf(t ?? tokens[tokens.length - 1], line));
    return false;
  }
  buildUseCase(useCase, body) {
    let paths = expand(body.items);
    if (paths.length > MAX_SCENARIOS) {
      this.warning(`Too many scenarios (${paths.length}); only the first ${MAX_SCENARIOS} are kept`, useCase.loc);
      paths = paths.slice(0, MAX_SCENARIOS);
    }
    const taken = /* @__PURE__ */ new Set();
    const scenarios = paths.map((path) => {
      const base = path.names.length ? slug(path.names.join(" ")) || "scenario" : "main";
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      taken.add(id);
      const steps2 = this.buildSteps(useCase.id, id, path.steps);
      const entry2 = steps2[0];
      const failedEntry = !!entry2 && (entry2.failed || (entry2.statusCode ?? 0) >= 400);
      const condition = path.conditions.join(" \xB7 ");
      return {
        id,
        name: path.names.length ? path.names.join(" \u203A ") : useCase.name,
        outcome: failedEntry ? "error" : "success",
        ...condition ? { condition } : {},
        steps: steps2,
        loc: path.locs.at(-1) ?? useCase.loc
      };
    });
    const steps = scenarios[0]?.steps ?? [];
    const entry = steps[0];
    return {
      ...useCase,
      entryServiceId: entry?.fromServiceId,
      endpoint: entry?.httpMethod ? `${entry.httpMethod} ${entry.endpoint}` : void 0,
      steps,
      scenarios
    };
  }
  buildSteps(useCaseId, scenarioId, raw) {
    const steps = [];
    const answered = /* @__PURE__ */ new Set();
    const prefix = scenarioId === "main" ? useCaseId : `${useCaseId}-${scenarioId}`;
    for (const step of raw) {
      this.checkConnection(step);
      if (step.arrow === "-->") {
        const [respFrom] = this.splitRef(step.from);
        const [respTo] = this.splitRef(step.to);
        const request2 = [...steps].reverse().find((s) => s.fromServiceId === respTo && s.toServiceId === respFrom && !answered.has(s) && !s.failed);
        if (!request2) {
          this.warning(`Response has no matching request from '${step.to}' to '${step.from}'`, step.loc);
          continue;
        }
        answered.add(request2);
        request2.responseLoc = step.loc;
        if (steps.length > steps.indexOf(request2) + 1 && !(step.parallelGroup !== void 0 && step.parallelGroup === request2.parallelGroup)) {
          request2.deferredResponse = { after: steps.length, ...step.parallelGroup !== void 0 ? { group: step.parallelGroup } : {} };
        }
        const status = step.label.match(/^(\d{3})\b\s*([\s\S]*)$/);
        if (status) {
          request2.statusCode = Number(status[1]);
          const responder = request2.toPort !== void 0 ? this.portType(request2.toServiceId, request2.toPort) : this.nodes.get(respFrom)?.resolvedType;
          this.checkStatus(responder, request2.statusCode, this.labelLoc(step, 0, 3));
        }
        const payload = splitPayload(status ? status[2] : step.label);
        const body = payload.body ?? payload.text;
        if (body) {
          request2.responseBody = body;
          request2.responseFormat = payload.body ? payload.format : "FREE_TEXT";
        }
        if (request2.executionType === "ASYNC_FIRE_AND_FORGET") request2.executionType = "ASYNC_REQUEST_RESPONSE";
        continue;
      }
      const label = parseStepLabel(step.label);
      const [from, fromPort] = this.splitRef(step.from);
      const [to, toPort] = this.splitRef(step.to);
      const port = toPort ?? this.onlyEntry(to, step.loc);
      const target = this.nodes.get(to);
      const isAsync = step.arrow === "->>";
      const type = port !== void 0 ? this.portType(to, port) : target?.resolvedType;
      const typed = this.typedOp(type, label.method, step);
      if (label.headers) this.checkHeaders(type, label.headers, step);
      steps.push({
        id: `${prefix}-${steps.length + 1}`,
        stepOrder: steps.length,
        stepName: label.name || `${step.from} \u2192 ${step.to}`,
        fromServiceId: from,
        toServiceId: to,
        protocol: inferProtocol(isAsync, label.method, target),
        httpMethod: label.method ?? "",
        endpoint: label.endpoint ?? "",
        requestFormat: label.format ?? "JSON",
        requestBody: label.body,
        responseFormat: "JSON",
        description: label.description,
        executionType: isAsync ? "ASYNC_FIRE_AND_FORGET" : "SYNC_REQUEST_RESPONSE",
        parallelGroup: step.parallelGroup,
        isParallel: step.parallelGroup !== void 0,
        isConditional: false,
        ...step.arrow === "-x" ? { failed: true } : {},
        loc: step.loc,
        ...step.multiplier !== void 0 ? { multiplier: step.multiplier } : {},
        ...step.sizeBytes !== void 0 ? { sizeBytes: step.sizeBytes } : {},
        access: typed.access,
        ...typed.op ? { op: typed.op } : {},
        ...label.headers ? { headers: label.headers } : {},
        ...port !== void 0 ? { toPort: port } : {},
        ...fromPort !== void 0 ? { fromPort } : {}
      });
    }
    resolveForwards(steps);
    return steps;
  }
  /** The type behind entry point `port` of system `id` (see entryType). */
  portType(id, port) {
    const system = this.systemById.get(id);
    return system && entryType(system, port);
  }
  /**
   * The access of a request step and the operation of its target's type it
   * names (docs/design/typed-components.md, "Typed operations in steps"). A
   * typed target with operations looks up the HTTP method or the label's first
   * words; a match decides the access. Otherwise the step reads as before
   * (`accessOf`), with a warning when the target is typed: the label is a
   * comment, unless its verb was already a write, which it stays.
   */
  typedOp(type, method, step) {
    const access = accessOf(method, step.label);
    if (!type || type.ops.length === 0) return { access };
    const word = method ?? opWord(step.label);
    if (!word) return { access };
    const op = method ? type.ops.find((o) => o.name.toUpperCase() === method) : findOp(type, step.label);
    if (op) return { access: op.access === "forward" ? access : op.access, op: { ...op } };
    const suggestion = suggestOp(type, word);
    const ops = opNamesMostSpecificFirst(type, this.typeTable);
    const hint = suggestion ? `Did you mean ${suggestion}?` : `Its operations are ${ops.slice(0, 8).join(", ")}${ops.length > 8 ? ", \u2026" : ""}.`;
    const effect = access === "write" ? "Treated as a write, as before." : "Treated as a comment.";
    const lead = step.label.length - step.label.trimStart().length + (!method && /^\s*"/.test(step.label) ? 1 : 0);
    this.typeProblem(`${type.name} has no operation '${word}'. ${hint} ${effect}`, this.labelLoc(step, lead, word.length));
    return { access };
  }
  /** `200` on a response: one of the responder's type's statuses, when it lists any. */
  checkStatus(type, code, loc) {
    if (!type || type.statuses.length === 0 || type.statuses.includes(code)) return;
    const listed = type.statuses.length > 12 ? `${type.statuses.slice(0, 12).join(", ")}, \u2026` : type.statuses.join(", ");
    this.typeProblem(`${type.name} has no status ${code}; it answers ${listed}`, loc);
  }
  /** `header A, B` in a label: each one of the target's type's headers, when it lists any. */
  checkHeaders(type, headers, step) {
    if (!type || type.headers.length === 0) return;
    const clause = step.label.search(/\sheader\s/);
    for (const h2 of headers) {
      if (findHeader(type, h2)) continue;
      const suggestion = suggestHeader(type, h2);
      const at = step.label.indexOf(h2, clause + 1);
      this.typeProblem(
        `${type.name} has no header '${h2}'. ${suggestion ? `Did you mean ${suggestion}?` : `Its headers are ${type.headers.join(", ")}.`}`,
        this.labelLoc(step, Math.max(0, at), h2.length)
      );
    }
  }
  /** `length` characters at `offset` in a step's label; the whole step when the label's column is unknown. */
  labelLoc(step, offset, length) {
    if (step.labelCol === void 0) return step.loc;
    return { line: step.loc.line, col: step.labelCol + offset, length, ...step.loc.file !== void 0 ? { file: step.loc.file } : {} };
  }
  /** A typed-step problem: a warning, or an error with `strictOps`. */
  typeProblem(message, loc) {
    if (this.options.strictOps) this.errorOnce(message, loc);
    else this.warning(message, loc);
  }
  /**
   * Warns when a step talks between two nodes the architecture never connects.
   * Documents without any connection are use-case-only sketches; they are left alone.
   */
  checkConnection(step) {
    const [a] = this.splitRef(step.from);
    const [b] = this.splitRef(step.to);
    if (this.edges.length === 0 || a === b || this.connected.has(`${a}|${b}`)) return;
    const [from, to] = step.arrow === "-->" ? [b, a] : [a, b];
    this.warning(`No connection between '${from}' and '${to}' in the architecture; add '${from} -> ${to}'`, step.loc);
  }
  createImplicitNodes() {
    for (const ref of this.references) {
      if (this.nodes.has(ref.id)) continue;
      this.nodes.set(ref.id, { id: ref.id, kind: "component", name: ref.id, type: "shape", techStack: DEFAULT_TECH, implicit: true, loc: ref.loc });
    }
  }
  addNode(node) {
    const existing = this.nodes.get(node.id);
    if (existing) {
      this.error(`Duplicate id '${node.id}' (first declared ${this.where(existing.loc, node.loc)})`, node.loc);
      return;
    }
    this.nodes.set(node.id, node);
  }
  /** `on line 3`, or `in infra.proschi on line 3` when `first` is in another file than `later`. */
  where(first, later) {
    return first.file === later.file ? `on line ${first.line}` : `in ${fileName(first.file ?? this.options.path ?? "the root document")} on line ${first.line}`;
  }
  /**
   * A node's `[Tech]`: the catalog entry it names (name or alias), or for an
   * unknown tech the text as written, with a warning that names the closest
   * catalog tech. It is drawn and simulated as the kind its name suggests
   * (`TigerBeetle DB`: database), else the kind of that closest tech
   * (`Postgress`: database), else a service; never a free, infinitely fast
   * client.
   */
  resolveTech(value, loc) {
    const found = findTech(value);
    if (found) return { type: found.type, techStack: found.techStack };
    const text = value.trim();
    if (!text) {
      this.warning(`Empty tech stack; drawing a ${DEFAULT_TECH}`, loc);
      return { type: "shape", techStack: DEFAULT_TECH };
    }
    const suggestion = suggestTech(text);
    const closest = suggestion && findTech(suggestion);
    const kind = kindFromName(text) ?? (closest ? kindOf({ kind: "component", type: closest.type, techStack: closest.techStack }) : void 0) ?? "service";
    this.warning(unknownTechMessage(text, kind, suggestion), loc);
    return { type: TYPE_OF_KIND[kind], techStack: text, inferredKind: kind };
  }
  /**
   * Resolves the type blocks of every file against the stdlib, then each
   * node's `[Tech]`: a type gives the node its kind and the icon of its
   * nearest built-in ancestor (D5); anything else is resolved as before.
   */
  resolveTypes() {
    const resolution = resolveTypes(this.typeDecls, builtinTypes());
    this.diagnostics.push(...resolution.diagnostics);
    this.typeTable = resolution.table;
    this.types = resolution.types;
    for (const ref of this.techRefs) this.applyTech(ref);
  }
  applyTech({ node, value, loc }) {
    const type = lookupType(this.typeTable, value);
    if (!type) {
      if (findTech(value)) return;
      const resolved = this.resolveTech(value, loc);
      node.type = resolved.type;
      node.techStack = resolved.techStack;
      if (resolved.inferredKind) node.inferredKind = resolved.inferredKind;
      return;
    }
    node.resolvedType = type;
    if (type.abstract) {
      const concrete = [...this.typeTable.values()].find((t) => !t.abstract && t.parents[0] === type.name);
      this.warning(`'${type.name}' is an abstract type; use a type that extends it${concrete ? `, like [${concrete.name}]` : ""}`, loc);
    }
    const kind = type.kind ?? kindFromName(type.name) ?? "service";
    const icon = findTech(type.icon ?? GENERIC_TECH[kind]);
    if (icon) {
      node.type = icon.type;
      node.techStack = icon.techStack;
      node.kind = icon.type === "text" ? "text" : icon.type === "group" ? "group" : "component";
    }
    if (type.kind) delete node.inferredKind;
    else node.inferredKind = kind;
  }
  /** `[abstract] type Name [extends Parent] {`, or a whole one-line block `… { op write APPEND }`; `at` is the name's index. */
  parseType(tokens, at, line) {
    const nameToken = tokens[at];
    const extendsAt = isWord(tokens[at + 1], "extends") ? at + 1 : -1;
    const parentToken = extendsAt === -1 ? void 0 : tokens[extendsAt + 1];
    const decl = {
      name: nameToken.value,
      abstract: at === 2,
      ...parentToken && (parentToken.kind === "ident" || parentToken.kind === "tech") ? { parent: parentToken.value, parentLoc: this.locOf(parentToken, line) } : {},
      props: {},
      ops: [],
      statuses: [],
      headers: [],
      builtin: false,
      loc: this.locOf(nameToken, line)
    };
    const braceAt = extendsAt === -1 ? at + 1 : extendsAt + 2;
    const skip = () => {
      if (tokens[tokens.length - 1].kind === "lbrace") this.stack.push({ kind: "type", decl, discard: true, loc: decl.loc });
    };
    if (extendsAt !== -1 && decl.parent === void 0) {
      this.error("Expected the parent type after extends, e.g. type LedgerDb extends PostgreSQL {", this.locOf(parentToken ?? tokens[extendsAt], line));
      return skip();
    }
    if (tokens[braceAt]?.kind !== "lbrace") {
      this.error("Expected { after the type header, e.g. type LedgerDb extends PostgreSQL {", this.locOf(tokens[braceAt] ?? tokens[braceAt - 1], line));
      return skip();
    }
    if (!decl.name.trim()) {
      this.error("Expected a type name, e.g. type LedgerDb extends PostgreSQL {", decl.loc);
      return skip();
    }
    if (this.stack.length > 0) {
      this.error("Declare types at the top level, not inside a block", this.locOf(tokens[0], line));
      return skip();
    }
    const last = tokens[tokens.length - 1];
    if (last.kind === "rbrace" && tokens.length > braceAt + 1) {
      const body = tokens.slice(braceAt + 1, -1);
      if (body.length) this.parseTypeLine(decl, body, line);
    } else if (tokens.length > braceAt + 1) {
      this.error("Expected the type body on the next lines, or on this one closed with }", this.locOf(tokens[braceAt + 1], line));
      return skip();
    } else {
      this.stack.push({ kind: "type", decl, loc: decl.loc });
    }
    this.typeDecls.push(decl);
  }
  /** One line of a type block: `kind database`, `op read SELECT`, `latencyMs 4`, … */
  parseTypeLine(decl, tokens, line) {
    const [key, value] = tokens;
    const loc = (t) => this.locOf(t ?? tokens[tokens.length - 1], line);
    if (key.kind !== "ident") {
      this.error(`Expected a type property: ${TYPE_LINES}`, loc(key));
      return;
    }
    const word = key.value;
    const single = (kinds, example) => {
      if (!value || !kinds.includes(value.kind)) {
        this.error(`Expected ${example}`, loc(value ?? key));
        return void 0;
      }
      this.expectEnd(tokens, 2, line);
      return value.value;
    };
    switch (word) {
      case "kind": {
        const kind = single(["ident"], `a kind after kind: ${KINDS.join(", ")}`);
        if (kind === void 0) return;
        if (!isKind(kind)) this.error(`Unknown kind '${kind}'; use one of ${KINDS.join(", ")}`, loc(value));
        else decl.kind = kind;
        return;
      }
      case "protocol": {
        const protocol = single(["ident", "string"], "a protocol after protocol, e.g. protocol SQL");
        if (protocol !== void 0) decl.protocol = protocol;
        return;
      }
      case "icon": {
        const icon = single(["ident", "tech", "string"], "a catalog tech after icon, e.g. icon PostgreSQL or icon [REST API]");
        if (icon !== void 0) decl.icon = icon;
        return;
      }
      case "doc": {
        const doc = single(["string"], 'a quoted description after doc, e.g. doc "Keeps the ledger"');
        if (doc !== void 0) decl.doc = doc;
        return;
      }
      case "op":
        this.parseTypeOp(decl, tokens, line);
        return;
      case "status": {
        const codes = this.readList(tokens, 1, line, ["number"], "status codes, e.g. status 200, 201, 404");
        for (const code of codes ?? []) {
          const n = Number(code.value);
          if (n < 100 || n > 599) this.error(`'${code.value}' is not an HTTP status code (100 to 599)`, loc(code));
          else if (!decl.statuses.includes(n)) decl.statuses.push(n);
        }
        return;
      }
      case "header": {
        const names = this.readList(tokens, 1, line, ["ident", "string"], 'header names, e.g. header Authorization, "Content-Type"');
        for (const name of names ?? []) if (!decl.headers.some((h2) => h2.toLowerCase() === name.value.toLowerCase())) decl.headers.push(name.value);
        return;
      }
    }
    if (Object.hasOwn(CHOICE_PROPS, word)) {
      const prop = word;
      const choices = CHOICE_PROPS[prop];
      const choice = single(["ident"], `${choices.join(" or ")} after ${prop}`);
      if (choice === void 0) return;
      if (!choices.includes(choice)) this.error(`Expected ${choices.join(" or ")} after ${prop}, not '${choice}'`, loc(value));
      else if (prop === "durable") decl.props.durable = choice === "true";
      else if (prop === "consistency") decl.props.consistency = choice;
      else decl.props.writeScaling = choice;
      return;
    }
    if (Object.hasOwn(NUMBER_PROPS, word)) {
      const prop = word;
      const unit = NUMBER_PROPS[prop];
      const example = prop === "availability" ? "a percentage after availability, e.g. availability 99.95%" : `a number after ${prop}, e.g. ${prop} ${unit === "rps" ? "20k" : "4"}`;
      if (!value || value.kind !== "number" && value.kind !== "quantity") {
        this.error(`Expected ${example}`, loc(value ?? key));
        return;
      }
      this.expectEnd(tokens, 2, line);
      const q = parseQuantity(value.value);
      if ("error" in q) {
        this.error(q.error, loc(value));
        return;
      }
      if (q.unit !== void 0 && q.unit !== unit) {
        this.error(`Expected ${example}, not ${kindName(q.unit)}`, loc(value));
        return;
      }
      if (prop !== "availability") decl.props[prop] = q.value;
      else if (q.unit === "%" && q.value > 0 && q.value <= 100) decl.props.availability = Number((q.value / 100).toPrecision(12));
      else this.error(`Expected ${example}`, loc(value));
      return;
    }
    this.error(`Unknown type property '${word}'; use ${TYPE_LINES}`, loc(key));
  }
  /** `op read SELECT, Scan latency 8 cost 2`: operations with their access (read, write or forward) and optional multipliers. */
  parseTypeOp(decl, tokens, line) {
    const access = tokens[1];
    if (!isWord(access, "read") && !isWord(access, "write") && !isWord(access, "forward")) {
      this.error("Expected read, write or forward after op, e.g. op read SELECT", this.locOf(access ?? tokens[0], line));
      return;
    }
    let end = 2;
    while (end < tokens.length && !isWord(tokens[end], "latency") && !isWord(tokens[end], "cost")) end++;
    const example = `operation names after op ${access.value}, e.g. op ${access.value} ${access.value === "read" ? "SELECT" : access.value === "forward" ? "MESSAGE" : "INSERT, UPDATE"}`;
    const names = this.readList(tokens.slice(0, end), 2, line, ["ident", "string"], example);
    if (!names) return;
    const multipliers = {};
    for (let i = end; i < tokens.length; i += 2) {
      const [word, number] = [tokens[i], tokens[i + 1]];
      if (!isWord(word, "latency") && !isWord(word, "cost")) {
        this.error(`Unexpected ${describe(word)}; an op ends with latency <n> and cost <n>`, this.locOf(word, line));
        return;
      }
      const q = number && (number.kind === "number" || number.kind === "quantity") ? parseQuantity(number.value) : void 0;
      if (!q || "error" in q || q.unit !== void 0 || q.value <= 0) {
        this.error(`Expected a multiplier after ${word.value}, e.g. ${word.value} 2 or ${word.value} 0.5`, this.locOf(number ?? word, line));
        return;
      }
      multipliers[word.value] = q.value;
    }
    for (const name of names) {
      const op = { name: name.value, access: access.value, ...multipliers };
      const at = decl.ops.findIndex((o) => o.name === op.name);
      if (at === -1) decl.ops.push(op);
      else decl.ops[at] = op;
    }
  }
  /** `header Authorization, Content-Type`, read from the line's text. */
  parseHeaders(decl, text, line) {
    const keyword = text.indexOf("header");
    const start2 = keyword + "header".length;
    const body = stripTrailingComment(text.slice(start2));
    if (!body.trim()) {
      this.error("Expected header names, e.g. header Authorization, Content-Type", { line, col: keyword + 1, length: 6, ...this.fileField() });
      return;
    }
    let col = start2 + 1;
    for (const part of body.split(",")) {
      const raw = part.trim();
      const name = raw.length > 1 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
      const loc = { line, col: col + part.indexOf(raw), length: Math.max(1, raw.length), ...this.fileField() };
      col += part.length + 1;
      if (!HEADER_NAME.test(name)) this.error(`Expected a header name, e.g. Content-Type${raw ? `, not '${raw}'` : ""}`, loc);
      else if (!decl.headers.some((h2) => h2.toLowerCase() === name.toLowerCase())) decl.headers.push(name);
    }
  }
  /** Comma-separated tokens of `kinds` from `tokens[from]` to the end; undefined (after an error) when malformed. */
  readList(tokens, from, line, kinds, example) {
    const items = [];
    for (let i = from; i < tokens.length; i += 2) {
      const [item, sep] = [tokens[i], tokens[i + 1]];
      if (!kinds.includes(item.kind)) {
        this.error(`Expected ${example}`, this.locOf(item, line));
        return void 0;
      }
      items.push(item);
      if (sep && (sep.kind !== "comma" || i + 2 >= tokens.length)) {
        this.error(sep.kind === "comma" ? "Expected another name after ," : `Expected , or the end of the line, not ${describe(sep)}`, this.locOf(sep, line));
        return void 0;
      }
    }
    if (!items.length) {
      this.error(`Expected ${example}`, this.locOf(tokens[from - 1], line));
      return void 0;
    }
    return items;
  }
  useCaseId(name) {
    const base = slug(name) || "usecase";
    const taken = new Set(this.useCases.map((u) => u.useCase.id));
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }
  top() {
    return this.stack[this.stack.length - 1];
  }
  currentGroup() {
    const top = this.top();
    return top?.kind === "group" ? top.id : void 0;
  }
  currentUseCase() {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame2 = this.stack[i];
      if (frame2.kind === "usecase") return frame2;
    }
    return void 0;
  }
  currentBody() {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame2 = this.stack[i];
      if (frame2.kind === "usecase" || frame2.kind === "alt") return frame2.body;
    }
    return void 0;
  }
  inUseCase() {
    return this.currentUseCase() !== void 0;
  }
  /** Reports the first token from `from` on; true when there is none. */
  expectEnd(tokens, from, line) {
    if (tokens.length <= from) return true;
    this.error(`Unexpected ${describe(tokens[from])}`, this.locOf(tokens[from], line));
    return false;
  }
  /** From the first token of a line to the end of its last one. */
  lineLoc(tokens, line) {
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    return { line, col: first.col, length: last.col + last.length - first.col, ...this.fileField() };
  }
  locOf(token, line) {
    return token ? { line, col: token.col, length: token.length, ...this.fileField() } : { line, col: 1, length: 1, ...this.fileField() };
  }
  /** `{ file }` inside an imported file; nothing for the root document, whose locations stay as they were. */
  fileField() {
    return this.file === void 0 ? {} : { file: this.file };
  }
  error(message, loc) {
    this.diagnostics.push({ severity: "error", message, ...loc });
  }
  /** An error for a step that every scenario sharing it would report again. */
  errorOnce(message, loc) {
    const key = `error
${loc.file ?? ""}
${loc.line}
${loc.col}
${message}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.error(message, loc);
  }
  info(message, loc) {
    const key = `info
${loc.file ?? ""}
${loc.line}
${loc.col}
${message}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.diagnostics.push({ severity: "info", message, ...loc });
  }
  warning(message, loc) {
    const key = `${loc.file ?? ""}
${loc.line}
${loc.col}
${message}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.diagnostics.push({ severity: "warning", message, ...loc });
  }
};
function expand(items) {
  let paths = [{ names: [], conditions: [], locs: [], steps: [] }];
  for (const item of items) {
    if (item.kind === "step") {
      for (const path of paths) path.steps.push(item.step);
      continue;
    }
    const next = [];
    for (const path of paths) {
      for (const branch of item.branches) {
        for (const sub of expand(branch.items)) {
          next.push({
            names: [...path.names, branch.name, ...sub.names],
            conditions: [...path.conditions, ...branch.condition ? [branch.condition] : [], ...sub.conditions],
            locs: [...path.locs, branch.loc, ...sub.locs],
            steps: [...path.steps, ...sub.steps]
          });
        }
      }
      if (next.length > MAX_SCENARIOS * 4) break;
    }
    paths = next;
  }
  return paths;
}
function findUseCaseIn(diagram, name) {
  const lower = name.toLowerCase();
  return diagram.useCases.find((u) => u.name === name) ?? diagram.useCases.find((u) => u.name.toLowerCase() === lower) ?? diagram.useCases.find((u) => u.id === name);
}
function isLet(tokens) {
  return isWord(tokens[0], "let") && tokens[1]?.kind === "ident" && tokens[2]?.kind === "op" && tokens[2].value === "=";
}
function isConstUse(token) {
  return token?.kind === "const" && token.value.startsWith("$");
}
var KIND_NAMES = {
  rps: "a rate",
  ms: "a duration",
  "%": "a percentage",
  "usd/month": "a monthly cost",
  MBps: "a bandwidth",
  "usd/GB": "an egress price"
};
function kindName(unit) {
  return unit ? KIND_NAMES[unit] : "a plain number";
}
function isTypeHeader(tokens, at) {
  const [name, next] = [tokens[at], tokens[at + 1]];
  return (name?.kind === "ident" || name?.kind === "tech") && (next?.kind === "lbrace" || isWord(next, "extends"));
}
function isWord(token, word) {
  return token?.kind === "ident" && token.value === word;
}
function sectionName(frame2) {
  if (frame2.skipped) return frame2.skipped;
  if (frame2.entity) return `entity '${frame2.entity.name}'`;
  if (frame2.decision) return `decision '${frame2.decision.title}'`;
  if (frame2.test) return `test '${frame2.test.name}'`;
  if (frame2.whatif) return `what-if '${frame2.whatif.name}'`;
  return `${frame2.section} block`;
}
function fileName(path) {
  return path.split(/[\\/]/).pop() || path;
}
function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function splitPayload(input) {
  const text = input.trim();
  const formats = { json: "JSON", xml: "XML", text: "FREE_TEXT" };
  const leading = text.match(/^(json|xml|text)\s+([\s\S]+)$/i);
  if (leading) return { text: "", format: formats[leading[1].toLowerCase()], body: leading[2].trim() };
  const keyed = text.match(/^([\s\S]*?)\s+(json|xml)\s+([{[<][\s\S]*)$/i);
  if (keyed) return { text: keyed[1].trim(), format: formats[keyed[2].toLowerCase()], body: keyed[3].trim() };
  const bare = text.search(/(^|\s)[{[<]/);
  if (bare !== -1) {
    const body = text.slice(bare).trim();
    return { text: text.slice(0, bare).trim(), format: body.startsWith("<") ? "XML" : "JSON", body };
  }
  return { text: unquote(text), format: "JSON" };
}
var HEADER_CLAUSE = /^header\s+([A-Za-z0-9-]+(?:\s*,\s*[A-Za-z0-9-]+)*)(?=\s|$)\s*([\s\S]*)$/;
function parseStepLabel(input) {
  const http = input.trim().match(/^([A-Z]+)\s+(\S+)\s*([\s\S]*)$/);
  if (http && HTTP_METHODS.includes(http[1])) {
    const clause = HEADER_CLAUSE.exec(http[3]);
    const payload2 = splitPayload(clause ? clause[2] : http[3]);
    return {
      ...clause ? { headers: clause[1].split(",").map((h2) => h2.trim()) } : {},
      name: `${http[1]} ${http[2]}`,
      method: http[1],
      endpoint: http[2],
      description: payload2.text || void 0,
      format: payload2.body ? payload2.format : void 0,
      body: payload2.body
    };
  }
  const payload = splitPayload(input);
  return { name: payload.text, format: payload.body ? payload.format : void 0, body: payload.body };
}
function entryType(system, port) {
  const useCaseId = system.entries.find((e) => e.id === port)?.useCaseId;
  const team = system.diagram;
  const first = team?.useCases.find((u) => u.id === useCaseId)?.steps[0];
  if (!team || !first) return void 0;
  const sender = team.nodes.find((n) => n.id === first.fromServiceId);
  if (sender && kindOf(sender) !== "client") return sender.resolvedType;
  if (first.toPort !== void 0) {
    const nested = team.systems?.find((s) => s.id === first.toServiceId);
    return nested && entryType(nested, first.toPort);
  }
  return team.nodes.find((n) => n.id === first.toServiceId)?.resolvedType;
}
function resolveForwards(steps) {
  const handler = (i, seen) => {
    const step = steps[i];
    for (let j = i + 1; j < steps.length; j++) {
      if (steps[j].fromServiceId !== step.toServiceId) continue;
      if (steps[j].op?.access !== "forward" || seen.has(j)) return steps[j];
      seen.add(j);
      return handler(j, seen) ?? steps[j];
    }
    return void 0;
  };
  steps.forEach((step, i) => {
    if (step.op?.access !== "forward") return;
    const next = handler(i, /* @__PURE__ */ new Set([i]));
    if (next && next.op?.access !== "forward" && next.access) step.access = next.access;
  });
}
var SIZE_UNITS = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
function parseSize(text) {
  const m = /^(\d+(?:\.\d+)?)([A-Za-z]*)$/.exec(text);
  if (!m) return { error: `Expected a payload size after ~, e.g. ~2MB, ~500KB or ~1.5GB${text ? `, not '~${text}'` : ""}` };
  const factor = SIZE_UNITS[m[2]];
  if (factor === void 0) return { error: m[2] ? `Unknown size unit '${m[2]}' in '~${text}'; use B, KB, MB, GB or TB` : `'~${text}' needs a unit: B, KB, MB, GB or TB` };
  const value = Math.round(Number(m[1]) * factor);
  if (value <= 0) return { error: `A payload size must be more than 0, not '~${text}'` };
  return { value };
}
function inferProtocol(isAsync, method, target) {
  if (isAsync || target?.type === "queue" || target?.type === "broker") return "MESSAGING";
  if (!method) return "OTHER";
  switch (target?.techStack) {
    case "GraphQL":
      return "GRAPHQL";
    case "gRPC":
      return "GRPC";
    case "SOAP API":
      return "SOAP";
    default:
      return "REST";
  }
}
function unquote(text) {
  const t = text.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}
function describe(token) {
  switch (token.kind) {
    case "string":
      return `string "${token.value}"`;
    case "tech":
      return `[${token.value}]`;
    case "team":
      return `@${token.value}`;
    case "tag":
      return `tag '.${token.value}'`;
    case "label":
      return "':'";
    case "lbrace":
    case "rbrace":
    case "comma":
    case "arrow":
      return `'${token.value}'`;
    default:
      return `'${token.value}'`;
  }
}

// ../frontend/src/dsl/imports.ts
var ImportError = class extends Error {
  name = "ImportError";
};
var LATEST_TAG = "latest";
var VERSION_TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
var CLOUD_NAME_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._+-]*$/;
var MAX_CLOUD_NAME = 200;
var MAX_SPEC_LENGTH = 1024;
var SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._ +-]*$/;
var HOST = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*(?::\d{1,5})?$/;
var REPO_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
var REF = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;
var SCHEME = /^([A-Za-z][A-Za-z0-9+.-]+):/;
function isRemoteSpec(spec) {
  return SCHEME.test(spec);
}
function isAbsolutePath(path) {
  return /^[\\/]/.test(path) || /^[A-Za-z]:/.test(path);
}
function checkRef(ref, spec) {
  if (!REF.test(ref) || ref.length > 200 || ref.includes("..") || ref.includes("//") || ref.endsWith("/") || ref.endsWith(".") || ref.endsWith(".lock") || ref.split("/").some((p) => p.startsWith("."))) {
    throw new ImportError(`'${spec}' has an invalid ref '${ref}'; use a tag, branch or commit made of letters, digits, '.', '_', '-' and '/'`);
  }
}
function repoPathSegments(path, spec) {
  const parts = path.split("/");
  if (!path || parts.some((p) => !SEGMENT.test(p) || p === "." || p === "..")) {
    throw new ImportError(`'${spec}' has an invalid path in the repository; use a relative path like dir/file.proschi, without '..'`);
  }
  return parts;
}
function parseRemoteSpec(spec) {
  const scheme = SCHEME.exec(spec)?.[1].toLowerCase();
  if (!scheme) return void 0;
  if (spec.length > MAX_SPEC_LENGTH) throw new ImportError(`Import source is longer than ${MAX_SPEC_LENGTH} characters`);
  if (/[\s\0\\]/.test(spec)) throw new ImportError(`'${spec}' contains whitespace or a backslash`);
  if (scheme === "git") {
    const body = spec.slice(4);
    const at = body.lastIndexOf("@");
    const split2 = body.indexOf("//");
    if (at === -1 || split2 === -1 || split2 > at) {
      throw new ImportError(`'${spec}' is not a git source; write git:<host>/<org>/<repo>//<path/in/repo>@<ref>`);
    }
    const repo = body.slice(0, split2);
    const path = body.slice(split2 + 2, at);
    const ref = body.slice(at + 1);
    const [host, ...names] = repo.split("/");
    if (!HOST.test(host) || names.length < 2 || names.some((n) => !REPO_SEGMENT.test(n) || n.endsWith("."))) {
      throw new ImportError(`'${spec}' names an invalid repository '${repo}'; write <host>/<org>/<repo>`);
    }
    repoPathSegments(path, spec);
    checkRef(ref, spec);
    return { kind: "git", repo, path, ref };
  }
  if (scheme === "cloud") return parseCloudSpec(spec);
  if (scheme === "http") throw new ImportError(`'${spec}' uses http://; only https:// imports are allowed`);
  if (scheme !== "https") throw new ImportError(`'${spec}' is not a supported import source; use a relative path, git:, https:// or cloud:`);
  let url;
  try {
    url = new URL(spec);
  } catch {
    throw new ImportError(`'${spec}' is not a valid URL`);
  }
  if (url.username || url.password) throw new ImportError(`'${spec}' contains credentials; git and https imports use your own credentials, never ones in the diagram`);
  if (url.hash) throw new ImportError(`'${spec}' has a #fragment; remove it`);
  if (!HOST.test(url.host)) throw new ImportError(`'${spec}' has an invalid host`);
  return { kind: "https", url: url.href };
}
function parseCloudSpec(spec) {
  const body = spec.slice("cloud:".length);
  const split2 = body.indexOf("//");
  const head = split2 === -1 ? body : body.slice(0, split2);
  const parts = head.split(":");
  if (parts.length > 2) throw new ImportError(`'${spec}' is not a cloud source; write cloud:<name> or cloud:<name>:<tag>`);
  const name = parts[0].endsWith(".proschi") ? parts[0].slice(0, -".proschi".length) : parts[0];
  if (!name || name.length > MAX_CLOUD_NAME || name.split("/").some((p) => !CLOUD_NAME_SEGMENT.test(p) || p === "." || p === "..")) {
    throw new ImportError(
      `'${spec}' names an invalid diagram '${parts[0]}'; use the diagram's file name (letters, digits, '.', '_', '+', '-' and '/', no spaces), with or without .proschi`
    );
  }
  const tag = parts.length === 2 ? parts[1] : LATEST_TAG;
  if (!VERSION_TAG.test(tag)) {
    throw new ImportError(`'${spec}' has an invalid version tag '${tag}'; use up to 64 letters, digits, '.', '_' and '-', starting with a letter or digit, e.g. 2026-11-01`);
  }
  if (split2 === -1) return { kind: "cloud", name, tag };
  return { kind: "cloud", name, tag, path: repoPathSegments(body.slice(split2 + 2), spec).join("/") };
}
function formatRemoteSpec(spec) {
  if (spec.kind === "cloud") return `cloud:${spec.name}:${spec.tag}${spec.path ? `//${spec.path}` : ""}`;
  return spec.kind === "git" ? `git:${spec.repo}//${spec.path}@${spec.ref}` : spec.url;
}
function resolveImportPath(fromPath, importPath) {
  if (importPath.includes("\0")) throw new ImportError(`'${importPath.replace(/\0/g, "")}' contains a NUL character`);
  const remote = parseRemoteSpec(importPath);
  if (remote?.kind === "cloud" && fromPath && isRemoteSpec(fromPath) && parseRemoteSpec(fromPath)?.kind !== "cloud") {
    throw new ImportError(`'${importPath}' is a cloud import inside ${fromPath}; cloud: sources only work from your own diagrams`);
  }
  if (remote) return formatRemoteSpec(remote);
  if (isAbsolutePath(importPath)) throw new ImportError(`'${importPath}' is an absolute path; imports must be relative to the importing file`);
  const from = fromPath && isRemoteSpec(fromPath) ? parseRemoteSpec(fromPath) : void 0;
  if (from?.kind === "cloud") {
    const parts2 = (from.path ?? "").split("/").slice(0, -1);
    for (const part of importPath.split("/")) {
      if (part === "" || part === ".") continue;
      if (part !== "..") parts2.push(part);
      else if (parts2.length > 0) parts2.pop();
      else throw new ImportError(`'${importPath}' leaves the files saved with cloud:${from.name}:${from.tag}`);
    }
    return formatRemoteSpec({ ...from, path: repoPathSegments(parts2.join("/"), importPath).join("/") });
  }
  if (from?.kind === "git") {
    const parts2 = from.path.split("/").slice(0, -1);
    for (const part of importPath.split("/")) {
      if (part === "" || part === ".") continue;
      if (part !== "..") parts2.push(part);
      else if (parts2.length > 0) parts2.pop();
      else throw new ImportError(`'${importPath}' leaves the repository ${from.repo}`);
    }
    repoPathSegments(parts2.join("/"), importPath);
    return formatRemoteSpec({ ...from, path: parts2.join("/") });
  }
  if (from?.kind === "https") {
    const base = new URL(from.url);
    const url = new URL(importPath, base);
    if (url.origin !== base.origin) throw new ImportError(`'${importPath}' leaves ${base.origin}`);
    return formatRemoteSpec(parseRemoteSpec(url.href));
  }
  const parts = !fromPath ? [] : fromPath.split("/").slice(0, -1);
  for (const part of importPath.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}
function joinImportPath(fromPath, importPath) {
  try {
    return resolveImportPath(fromPath, importPath);
  } catch (e) {
    if (e instanceof ImportError) return void 0;
    throw e;
  }
}
function mapResolver(files) {
  const paths = Object.keys(files).filter((p) => !isRemoteSpec(p));
  return (importPath, fromPath) => {
    const path = resolveImportPath(fromPath, importPath);
    if (Object.prototype.hasOwnProperty.call(files, path)) return { path, source: files[path] };
    if (isRemoteSpec(path)) return void 0;
    const name = path.split("/").pop();
    const sameName = paths.filter((p) => p.split("/").pop() === name);
    return sameName.length === 1 ? { path: sameName[0], source: files[sameName[0]] } : void 0;
  };
}

// ../frontend/src/playground/share.ts
var import_lz_string = __toESM(require_lz_string(), 1);

// ../frontend/src/playground/lzBounded.ts
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
var VALUE = new Map([...ALPHABET].map((c, i) => [c, i]));

// ../frontend/src/playground/share.ts
var PREFIX = "#code=";
function encodeShareHash(source, playback, imports) {
  let code = PREFIX + (0, import_lz_string.compressToEncodedURIComponent)(source);
  if (imports && Object.keys(imports).length) code += `&imports=${(0, import_lz_string.compressToEncodedURIComponent)(JSON.stringify(imports))}`;
  if (!playback) return code;
  const scenario = playback.scenario ? `&alt=${encodeURIComponent(playback.scenario)}` : "";
  return `${code}&uc=${encodeURIComponent(playback.useCase)}${scenario}&step=${playback.step}`;
}

// ../frontend/src/sim/access.ts
function stepAccess(step) {
  const op = step.op?.access;
  return step.access ?? (op === "read" || op === "write" ? op : void 0) ?? accessOf(step.httpMethod, step.stepName ?? "");
}
function accessIn(diagram) {
  const queues = new Set(diagram.nodes.filter((n) => kindMatches(kindOf(n), "queue")).map((n) => n.id));
  return (step) => queues.has(step.toServiceId) ? "write" : stepAccess(step);
}

// ../frontend/src/dsl/sequence.ts
var PAYLOAD_LIMIT = 40;
function shorten(text, max = PAYLOAD_LIMIT) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}\u2026` : flat;
}
function requestLabel(step) {
  const name = !step.httpMethod && step.stepName === `${step.fromServiceId} \u2192 ${step.toServiceId}` ? "" : step.stepName;
  return [name, step.description, step.requestBody && shorten(step.requestBody)].filter(Boolean).join(" ");
}
function responseLabel(step) {
  return [step.statusCode, step.responseBody && shorten(step.responseBody)].filter((p) => p !== void 0 && p !== "").join(" ");
}
function hasResponse(step) {
  return !step.failed && (!!step.responseLoc || step.statusCode !== void 0 || !!step.responseBody);
}
function request(step) {
  return {
    kind: "request",
    from: step.fromServiceId,
    to: step.toServiceId,
    number: step.stepOrder + 1,
    label: requestLabel(step),
    async: step.executionType !== "SYNC_REQUEST_RESPONSE",
    failed: !!step.failed,
    error: !!step.failed,
    step
  };
}
function response(step) {
  return {
    kind: "response",
    from: step.toServiceId,
    to: step.fromServiceId,
    number: step.stepOrder + 1,
    label: responseLabel(step),
    async: false,
    failed: false,
    error: (step.statusCode ?? 0) >= 400,
    status: step.statusCode,
    step
  };
}
function buildSequence(useCase, scenario, nodes = []) {
  const items = [];
  const stack = [];
  const emit = (message) => items.push({ kind: "message", message });
  const unwindFor = (from) => {
    const depth = stack.map((s) => s.toServiceId).lastIndexOf(from);
    while (stack.length > depth + 1) emit(response(stack.pop()));
  };
  const steps = scenario.steps;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.parallelGroup === void 0) {
      unwindFor(step.fromServiceId);
      emit(request(step));
      if (hasResponse(step)) stack.push(step);
      continue;
    }
    const group = [];
    while (i < steps.length && steps[i].parallelGroup === step.parallelGroup) group.push(steps[i++]);
    i--;
    unwindFor(step.fromServiceId);
    items.push({ kind: "par", branches: group.map((s) => hasResponse(s) ? [request(s), response(s)] : [request(s)]) });
  }
  while (stack.length) emit(response(stack.pop()));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const participants = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = byId.get(id);
    participants.push({ id, name: node?.name ?? id, tech: node && !node.implicit ? node.techStack : void 0 });
  };
  for (const step of steps) {
    add(step.fromServiceId);
    add(step.toServiceId);
  }
  return { useCase, scenario, participants, items, condition: scenario.condition || void 0 };
}
function sequenceMessages(items) {
  return items.flatMap((item) => item.kind === "message" ? [item.message] : item.branches.flat());
}

// ../frontend/src/sim/profiles.ts
var NEUTRAL = { rps: Infinity, latencyMs: 0, availability: 1, costUsd: 0, durable: false };
var INTERNET_EGRESS_USD_PER_GB = 0.09;
var CDN_EGRESS_USD_PER_GB = 0.02;
var RELATIONAL = {
  rps: 2e4,
  readRps: 2e4,
  writeRps: 5e3,
  writeScaling: "shards",
  latencyMs: 5,
  availability: 0.9995,
  costUsd: 400,
  durable: true,
  consistency: "strong"
};
var QUEUE = { rps: 5e4, latencyMs: 5, availability: 0.9999, costUsd: 200, durable: true, consistency: "strong" };
var KIND_PROFILES = {
  client: { ...NEUTRAL, bandwidthMBps: 10 },
  // A firewall or accelerator in front of everything else (WAF, Global Accelerator); `any edge` also selects the four below.
  edge: { rps: 1e5, latencyMs: 2, availability: 0.9999, costUsd: 50, durable: false },
  cdn: { rps: 2e5, latencyMs: 5, availability: 0.9999, costUsd: 100, durable: false, egressUsdPerGb: CDN_EGRESS_USD_PER_GB },
  loadbalancer: { rps: 1e5, latencyMs: 2, availability: 0.9999, costUsd: 50, durable: false },
  gateway: { rps: 1e4, latencyMs: 10, availability: 0.9995, costUsd: 100, durable: false },
  // Name resolution happens before the request and is cached: off the request path.
  dns: { rps: Infinity, latencyMs: 0, availability: 1, costUsd: 0, durable: false },
  service: { rps: 2e3, latencyMs: 10, availability: 0.995, costUsd: 100, durable: false },
  function: { rps: 1e4, latencyMs: 25, availability: 0.9995, costUsd: 200, durable: false },
  cache: { rps: 1e5, latencyMs: 1, availability: 0.999, costUsd: 150, durable: false, consistency: "eventual" },
  database: RELATIONAL,
  search: { rps: 3e3, latencyMs: 15, availability: 0.999, costUsd: 400, durable: true, consistency: "eventual" },
  analytics: { rps: 200, latencyMs: 500, availability: 0.999, costUsd: 300, durable: true, consistency: "eventual" },
  queue: QUEUE,
  // Same numbers as a queue for now: both take a message and hand it on later.
  broker: QUEUE,
  storage: { rps: 5e3, latencyMs: 30, availability: 0.9999, costUsd: 50, durable: true, consistency: "eventual" },
  external: { rps: 1e3, latencyMs: 200, availability: 0.999, costUsd: 0, durable: false },
  other: NEUTRAL
};
var NOSQL = { rps: 2e4, latencyMs: 5, availability: 0.9999, costUsd: 500, durable: true, consistency: "eventual" };
var NOSQL_STRONG = { ...NOSQL, consistency: "strong" };
var PROFILE_ROWS = { nosql: NOSQL, nosqlStrong: NOSQL_STRONG };
var TECH_PROFILES = Object.fromEntries(
  componentCatalog.flatMap((c) => "profile" in c ? [[c.techStack, PROFILE_ROWS[c.profile]]] : [])
);
var BANDWIDTH = {
  client: 10,
  edge: 1e3,
  cdn: 1e3,
  loadbalancer: 1e3,
  gateway: 1e3,
  dns: 1e3,
  service: 200
};
var DEFAULT_BANDWIDTH_MBPS = 100;
var CHARGES_EGRESS = (kind) => kind !== "client" && kind !== "external" && kind !== "dns" && kind !== "other";
var SIZES = {
  S: { capacity: 1, cost: 1 },
  M: { capacity: 2, cost: 1.8 },
  L: { capacity: 4, cost: 3.5 }
};
function profileOf(node, override) {
  const kind = kindOf(node);
  const type = node.resolvedType;
  const techRow = Object.hasOwn(TECH_PROFILES, node.techStack) && (!type || kindOf({ ...node, resolvedType: void 0 }) === kind) ? TECH_PROFILES[node.techStack] : void 0;
  const props = type?.props ?? {};
  const sides = props.rps !== void 0 ? { readRps: props.readRps ?? props.rps, writeRps: props.writeRps ?? props.rps } : {};
  const base = { ...techRow ?? KIND_PROFILES[kind], ...props, ...sides };
  const size = SIZES[override?.size ?? "S"];
  const baseRead = (base.readRps ?? base.rps) * size.capacity;
  const baseWrite = (base.writeRps ?? base.rps) * size.capacity;
  const readRps = override?.readRps ?? override?.rps ?? baseRead;
  const writeRps = override?.writeRps ?? override?.rps ?? baseWrite;
  const consistency = override?.consistency ?? base.consistency;
  return {
    kind,
    rps: readRps,
    readRps,
    writeRps,
    writeScaling: base.writeScaling ?? "replicas",
    shards: Math.max(1, Math.floor(override?.shards ?? 1)),
    latencyMs: override?.latencyMs ?? base.latencyMs,
    availability: override?.availability !== void 0 ? override.availability / 100 : base.availability,
    costUsd: override?.costUsd ?? base.costUsd * size.cost,
    durable: override?.durable ?? base.durable,
    ...consistency && isDataStore(kind) ? { consistency } : {},
    bandwidthMBps: override?.bandwidthMBps ?? base.bandwidthMBps ?? BANDWIDTH[kind] ?? DEFAULT_BANDWIDTH_MBPS,
    egressUsdPerGb: override?.egressUsdPerGb ?? base.egressUsdPerGb ?? (CHARGES_EGRESS(kind) ? INTERNET_EGRESS_USD_PER_GB : 0),
    ...override?.timeoutMs !== void 0 ? { timeoutMs: override.timeoutMs } : {}
  };
}
function capacityOf(p, replicas) {
  return {
    readRps: p.readRps * replicas * p.shards,
    writeRps: p.writeRps * (p.writeScaling === "shards" ? 1 : replicas) * p.shards
  };
}
function combinedUtilization(p, readUtilization, writeUtilization) {
  return p.writeScaling === "shards" ? Math.max(readUtilization, writeUtilization) : readUtilization + writeUtilization;
}

// ../frontend/src/sim/flow.ts
function findUseCase(diagram, name) {
  const lower = name.toLowerCase();
  return diagram.useCases.find((u) => u.name === name) ?? diagram.useCases.find((u) => u.name.toLowerCase() === lower) ?? diagram.useCases.find((u) => u.id === name);
}
function findScenario(useCase, name) {
  const norm = (s) => s.replace(/\s*(›|>)\s*/g, " \u203A ").trim().toLowerCase();
  const wanted = norm(name);
  return useCase.scenarios.find((s) => s.name === name) ?? useCase.scenarios.find((s) => norm(s.name) === wanted || s.id === name);
}
function afterEntryResponse(entry, step) {
  const r = entry.responseLoc;
  if (!r || step === entry || step.loc.file !== r.file) return false;
  return step.loc.line > r.line || step.loc.line === r.line && step.loc.col > r.col;
}
function criticalPath(useCase, scenario) {
  const entry = scenario.steps[0];
  if (!entry) return [];
  const { items } = buildSequence(useCase, scenario);
  const working = /* @__PURE__ */ new Map([[entry.fromServiceId, 1]]);
  const opened = /* @__PURE__ */ new Set();
  let answered = false;
  const parts = [];
  const visit = (m, hops) => {
    if (m.kind === "response") {
      if (opened.delete(m.step)) working.set(m.step.toServiceId, (working.get(m.step.toServiceId) ?? 1) - 1);
      if (m.step === entry) answered = true;
      return;
    }
    if (afterEntryResponse(entry, m.step)) answered = true;
    if (answered || !working.get(m.from)) return;
    hops.push({ step: m.step, target: m.to, failed: m.failed, async: m.async });
    if (!m.async && !m.failed) {
      opened.add(m.step);
      working.set(m.to, (working.get(m.to) ?? 0) + 1);
    }
  };
  for (const item of items) {
    const hops = [];
    if (item.kind === "message") visit(item.message, hops);
    else for (const branch of item.branches) for (const m of branch) visit(m, hops);
    if (hops.length) parts.push(hops);
  }
  return parts;
}
function pathNodes(useCase, scenario) {
  const entry = scenario.steps[0];
  if (!entry) return [];
  const ids = [entry.fromServiceId, ...criticalPath(useCase, scenario).flatMap((part) => part.filter((h2) => !h2.failed).map((h2) => h2.target))];
  return [...new Set(ids)];
}
function requestOrder(useCase, scenario) {
  const entry = scenario.steps[0];
  const messages = sequenceMessages(buildSequence(useCase, scenario).items);
  const requests = [];
  let beforeResponse = -1;
  for (const m of messages) {
    if (m.kind === "request") {
      if (beforeResponse < 0 && entry && afterEntryResponse(entry, m.step)) beforeResponse = requests.length;
      requests.push(m);
    } else if (m.step === entry && beforeResponse < 0) beforeResponse = requests.length;
  }
  return { requests, beforeResponse: beforeResponse < 0 ? requests.length : beforeResponse };
}
function writesBeforeResponse(useCase, scenario, accept, isWrite = (step) => stepAccess(step) === "write") {
  const { requests, beforeResponse } = requestOrder(useCase, scenario);
  return requests.slice(0, beforeResponse).some((m) => !m.async && !m.failed && accept(m.to) && isWrite(m.step));
}
function callsOk(scenario, nodeId) {
  return scenario.steps.some((s) => s.toServiceId === nodeId && !s.failed);
}
function needs(useCase, nodeId) {
  return useCase.scenarios.some((s) => s.outcome === "success" && callsOk(s, nodeId));
}
function fallbacksFor(useCase, nodeId) {
  return useCase.scenarios.filter((s) => {
    if (s.outcome !== "success") return false;
    const { requests, beforeResponse } = requestOrder(useCase, s);
    const early = requests.slice(0, beforeResponse).filter((m) => m.to === nodeId);
    const window = early.some((m) => m.failed) ? early : requests.filter((m) => m.to === nodeId);
    return window.some((m) => m.failed) && !window.some((m) => !m.failed && !m.async);
  });
}
function selectorText(selector) {
  if ("node" in selector) return selector.node;
  if ("tech" in selector) return `[${selector.tech}]`;
  if ("anyOf" in selector) return selector.anyOf.map(selectorText).join(" or ");
  if ("consistency" in selector) return `any ${selector.consistency} store`;
  return `any ${selector.kind}`;
}
function selectNodes(diagram, selector) {
  return diagram.nodes.filter((n) => n.kind === "component" && matches(n, selector, diagram));
}
function matches(node, selector, diagram) {
  if (node.kind !== "component") return false;
  if ("node" in selector) return node.id === selector.node;
  if ("tech" in selector) {
    const wanted = typeKey(selector.tech);
    return [node.techStack, node.resolvedType?.name, ...node.resolvedType?.parents ?? []].some((t) => t !== void 0 && typeKey(t) === wanted);
  }
  if ("anyOf" in selector) return selector.anyOf.some((s) => matches(node, s, diagram));
  if ("consistency" in selector) {
    const override = diagram?.capacity?.find((o) => o.node === node.id);
    return profileOf(node, override).consistency === selector.consistency;
  }
  return kindMatches(kindOf(node), selector.kind);
}
var isParam = (segment2) => /^\{[^}]*\}$/.test(segment2) || /^:\w+$/.test(segment2);
var segments2 = (path) => path.replace(/[?#].*$/, "").replace(/(.)\/+$/, "$1").split("/");
function pathMatches(pattern, endpoint) {
  const [a, b] = [segments2(pattern), segments2(endpoint)];
  return a.length === b.length && a.every((s, i) => s === b[i] || isParam(s) || isParam(b[i]));
}
function stepMatches(step, match) {
  if (!match) return true;
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  if (match.method !== void 0 && !same(step.httpMethod, match.method)) return false;
  if (match.path !== void 0 && !pathMatches(match.path, step.endpoint)) return false;
  if (match.op !== void 0 && !(step.op && same(step.op.name, match.op))) return false;
  if (match.header !== void 0 && !step.headers?.some((h2) => same(h2, match.header))) return false;
  return true;
}
function callText(selector, match) {
  const target = selectorText(selector);
  if (match?.op !== void 0) return `uses ${match.op} on ${target}`;
  if (match?.header !== void 0) return `sends header ${match.header} to ${target}`;
  if (match?.method !== void 0) return `calls ${target} with ${match.method} ${match.path ?? ""}`.trimEnd();
  return `calls ${target}`;
}
function techOf(node) {
  return node && !node.implicit ? node.techStack : void 0;
}
function nodeLabel(diagram, id) {
  const tech = techOf(diagram.nodes.find((n) => n.id === id));
  return tech ? `${id} (${tech})` : id;
}

// ../frontend/src/sim/format.ts
var trim = (n, digits) => String(Number(n.toFixed(digits)));
function formatRps(rps) {
  if (!Number.isFinite(rps)) return "\u221E rps";
  if (rps >= 1e6) return `${trim(rps / 1e6, 1)}m rps`;
  if (rps >= 1e3) return `${trim(rps / 1e3, 1)}k rps`;
  return `${trim(rps, rps < 10 ? 2 : 0)} rps`;
}
function formatMs(ms) {
  return `${trim(ms, ms < 100 ? 1 : 0)} ms`;
}
function formatAvailability(fraction) {
  if (fraction >= 1) return "100%";
  const down = (1 - fraction) * 100;
  const digits = Math.min(6, Math.max(1, Math.ceil(-Math.log10(down)) + 1));
  return `${trim(Math.floor(fraction * 100 * 10 ** digits + 1e-6) / 10 ** digits, digits)}%`;
}
function formatPercent(fraction) {
  return `${Math.round(fraction * 100)}%`;
}
function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "\u221E";
  if (ms < 1e3) return formatMs(ms);
  if (ms < 6e4) return `${trim(ms / 1e3, ms < 1e4 ? 1 : 0)} s`;
  if (ms < 36e5) return `${trim(ms / 6e4, 1)} min`;
  return `${trim(ms / 36e5, 1)} h`;
}
function formatCount(n) {
  if (n >= 1e9) return `${trim(n / 1e9, 1)}B`;
  if (n >= 1e6) return `${trim(n / 1e6, 1)}M`;
  if (n >= 1e3) return `${trim(n / 1e3, 1)}k`;
  return trim(n, 0);
}
function formatUsd(usd) {
  return `$${Math.round(usd).toLocaleString("en-US")}/month`;
}

// ../frontend/src/sim/overlay.ts
function flowsOf(diagram, traffic) {
  const flows = /* @__PURE__ */ new Map();
  for (const t of traffic) {
    const u = findUseCase(diagram, t.useCase);
    if (!u || t.rps <= 0) continue;
    for (const sc of u.scenarios) {
      const share2 = t.mix ? t.mix.find((m) => m.scenario === sc.name)?.share ?? 0 : sc === u.scenarios[0] ? 1 : 0;
      if (share2 <= 0) continue;
      for (const step of sc.steps) {
        if (step.failed) continue;
        const key = `${step.fromServiceId}>${step.toServiceId}`;
        const f = flows.get(key) ?? { from: step.fromServiceId, to: step.toServiceId, rps: 0, async: step.executionType !== "SYNC_REQUEST_RESPONSE" };
        f.rps += t.rps * share2 * (step.multiplier ?? 1);
        flows.set(key, f);
      }
    }
  }
  return [...flows.values()];
}
var works = (n) => Number.isFinite(n.capacityRps) && n.kind !== "client";
function analysedTraffic(diagram, analysis, failed) {
  const declared = resolveTraffic(diagram);
  const rates = new Map(analysis.useCases.map((u) => [u.id, u.rps]));
  const changed = failed.size > 0 || [...declared].some(([id, t]) => rates.has(id) && rates.get(id) !== t.rps);
  if (!changed) return diagram.traffic ?? [];
  const loc = { line: 0, col: 0, length: 0 };
  return [...trafficFor(diagram, { trafficRps: rates, failed })].flatMap(([id, t]) => {
    const u = diagram.useCases.find((c) => c.id === id);
    if (!u || !(t.rps > 0)) return [];
    return [{ useCase: u.name, rps: t.rps, mix: u.scenarios.map((s, i) => ({ scenario: s.name, share: t.shares[i] ?? 0 })), loc }];
  });
}
function analysisOverlay(diagram, analysis) {
  const nodes = {};
  const bottlenecks = new Set(bottlenecksOf(analysis));
  const latency2 = /* @__PURE__ */ new Map();
  const failed = /* @__PURE__ */ new Set();
  for (const n of analysis.nodes) {
    latency2.set(n.id, n.latencyMs);
    if (n.failed) failed.add(n.id);
    const busy = n.queue ? Math.max(n.utilization, Math.min(n.queue.utilization, 9.99)) : n.utilization;
    nodes[n.id] = {
      ...works(n) ? { utilization: busy, saturated: n.saturated || busy >= 1 } : {},
      ...n.queue ? n.queue.backlogPerHour > 0 ? { backlogPerHour: n.queue.backlogPerHour } : { lagMs: n.queue.lagMs } : {},
      ...n.replicas > 1 ? { replicas: n.replicas } : {},
      ...n.shards > 1 ? { shards: n.shards } : {},
      ...bottlenecks.has(n.id) ? { bottleneck: true } : {},
      ...n.failed ? { down: true } : {}
    };
  }
  const flows = flowsOf(diagram, analysedTraffic(diagram, analysis, failed)).filter((f) => !failed.has(f.from) && !failed.has(f.to)).map((f) => latency2.has(f.to) ? { ...f, latencyMs: latency2.get(f.to) } : f);
  const critical = criticalPathOf(diagram, analysis);
  return { nodes, flows, ...critical ? { critical } : {} };
}
var BOTTLENECK_FROM = 0.7;
function bottlenecksOf(analysis) {
  return analysis.nodes.filter((n) => works(n) && (n.saturated || n.utilization >= BOTTLENECK_FROM)).map((n) => n.id);
}
function criticalPathOf(diagram, analysis, useCase) {
  const live = analysis.useCases.filter((u2) => u2.rps > 0);
  const picked = useCase === void 0 ? void 0 : live.find((u2) => u2.id === useCase || u2.name === useCase);
  const result = picked ?? live.reduce((best, u2) => !best || u2.rps > best.rps ? u2 : best, void 0);
  if (!result) return void 0;
  const u = diagram.useCases.find((d) => d.id === result.id) ?? findUseCase(diagram, result.name);
  const scenario = u?.scenarios[result.tailScenario.p99] ?? u?.scenarios[0];
  const entry = scenario?.steps[0];
  if (!u || !scenario || !entry) return void 0;
  const hops = criticalPath(u, scenario).flat();
  const nodes = [entry.fromServiceId];
  for (const h2 of hops) if (!nodes.includes(h2.target)) nodes.push(h2.target);
  return {
    useCase: u.name,
    scenario: scenario.name,
    p99Ms: result.percentiles.p99,
    nodes,
    links: hops.map((h2) => ({ from: h2.step.fromServiceId, to: h2.step.toServiceId }))
  };
}

// ../frontend/src/sim/systems.ts
var teamKey = (s) => s.resolved ?? s.diagram;
var contracts = /* @__PURE__ */ new WeakMap();
function contractOf(system, options = {}) {
  let contract = contracts.get(system);
  if (!contract) {
    contract = system.diagram ? designContract(system, system.diagram, options) : stubContract(system);
    contracts.set(system, contract);
  }
  return contract;
}
function stubContract(system) {
  const stub = system.stub;
  if (!stub) return { source: "none", entries: system.entries.map((e) => emptyEntry(e.id, e.name)) };
  const rps = stub.rps ?? Infinity;
  return {
    source: "stub",
    entries: system.entries.map((e) => ({
      ...emptyEntry(e.id, e.name),
      latency: stub.p99Ms !== void 0 ? [{ percentile: 99, maxMs: stub.p99Ms }] : [],
      ...stub.availability !== void 0 ? { availabilityPercent: stub.availability } : {},
      saturatesAtRps: rps,
      hotAtRps: rps * HOT
    }))
  };
}
var emptyEntry = (entry, name) => ({ entry, name, ownRps: 0, latency: [], saturatesAtRps: Infinity, hotAtRps: Infinity });
function designContract(system, team, options) {
  const traffic = resolveTraffic(team);
  const base = computeLoad(team, traffic);
  const baseBytes = computeBytesPerSecond(team, traffic);
  const profiles = profilesOf(team);
  const nodes = components(team);
  const entries2 = system.entries.map((e) => {
    const u = team.useCases.find((x) => x.id === e.useCaseId);
    if (!u) return emptyEntry(e.id, e.name);
    const own = traffic.get(u.id);
    const unit = /* @__PURE__ */ new Map([[u.id, { rps: 1, shares: own.shares }]]);
    const delta = computeLoad(team, unit);
    const deltaBytes = computeBytesPerSecond(team, unit);
    const result = { ...emptyEntry(e.id, e.name), useCase: u.name, ownRps: own.rps };
    for (const n of nodes) {
      const d = delta.get(n.id);
      const db = deltaBytes.get(n.id) ?? 0;
      if (!d && !db) continue;
      const p = profiles.get(n.id);
      const replicas = replicasOf(n);
      const b = base.get(n.id) ?? { read: 0, write: 0 };
      const bb = baseBytes.get(n.id) ?? 0;
      const u0 = usageOf(p, replicas, b.read, b.write, bb);
      const u1 = usageOf(p, replicas, b.read + (d?.read ?? 0), b.write + (d?.write ?? 0), bb + db);
      const sat = crossing(u0, u1, 1);
      const hot = crossing(u0, u1, HOT);
      if (sat < result.saturatesAtRps) {
        result.saturatesAtRps = sat;
        result.bottleneck = n.id;
      }
      if (hot < result.hotAtRps) {
        result.hotAtRps = hot;
        result.hotNode = n.id;
      }
    }
    for (const r of team.requirements ?? []) {
      if (r.kind !== "latency" && r.kind !== "availability") continue;
      if (r.useCase !== void 0 && findUseCase(team, r.useCase) !== u) continue;
      if (r.kind === "latency") result.latency.push({ percentile: r.percentile, maxMs: r.maxMs, ...r.scenario !== void 0 ? { scenario: r.scenario } : {} });
      else result.availabilityPercent = Math.max(result.availabilityPercent ?? 0, r.minPercent);
    }
    return result;
  });
  return { source: "design", entries: entries2, baseline: analyze(team, { timeoutMs: options.timeoutMs }) };
}
function crossing(u0, u1, theta) {
  const terms = u0.writeScaling === "shards" ? [
    [u0.readUtilization, u1.readUtilization],
    [u0.writeUtilization, u1.writeUtilization]
  ] : [[u0.requestUtilization, u1.requestUtilization]];
  terms.push([u0.bandwidthUtilization, u1.bandwidthUtilization]);
  let best = Infinity;
  for (const [a, b] of terms) {
    const slope = b - a;
    if (slope <= 1e-15) continue;
    if (a >= theta) return 0;
    best = Math.min(best, (theta - a) / slope);
  }
  return best;
}
function inboundLoad(diagram, traffic) {
  const result = /* @__PURE__ */ new Map();
  forEachStepRate(diagram, traffic, (step, rate) => {
    if (step.toPort === void 0) return;
    const ports = result.get(step.toServiceId) ?? /* @__PURE__ */ new Map();
    ports.set(step.toPort, (ports.get(step.toPort) ?? 0) + rate * multiplierOf(step));
    result.set(step.toServiceId, ports);
  });
  return result;
}
function hopFrom(p50, p99) {
  const l50 = tailFactor(0.5);
  const l99 = tailFactor(0.99);
  let tailMs = Math.max(0, (p99 - p50) / (l99 - l50));
  let fixedMs = p50 - tailMs * l50;
  if (fixedMs < 0) {
    fixedMs = 0;
    tailMs = p99 / l99;
  }
  return { fixedMs, tailMs, waitProbability: 0 };
}
function analyzeSystems(diagram, traffic, options = {}) {
  const inbound = inboundLoad(diagram, traffic);
  if (!options.sharedSystems) options = { ...options, sharedSystems: sharedLoad(diagram, inbound) };
  const hops = /* @__PURE__ */ new Map();
  const availabilities = /* @__PURE__ */ new Map();
  const key = (id, port) => `${id}
${port}`;
  const systems = (diagram.systems ?? []).map((system) => {
    const result = analyzeSystem(system, inbound.get(system.id) ?? /* @__PURE__ */ new Map(), options);
    for (const e of result.entries) {
      hops.set(key(system.id, e.entry), hopFrom(e.p50Ms, e.p99Ms));
      availabilities.set(key(system.id, e.entry), e.availability);
    }
    return result;
  });
  return {
    systems,
    hop: (id, port) => port === void 0 ? void 0 : hops.get(key(id, port)),
    availability: (id, port) => port === void 0 ? void 0 : availabilities.get(key(id, port))
  };
}
function sentByUseCase(system, sent, into) {
  let total = 0;
  for (const e of system.entries) {
    const rps = sent.get(e.id) ?? 0;
    if (rps <= 0 || e.useCaseId === void 0) continue;
    into.set(e.useCaseId, (into.get(e.useCaseId) ?? 0) + rps);
    total += rps;
  }
  return total;
}
function sharedLoad(root, rootInbound) {
  const byFile = /* @__PURE__ */ new Map();
  const designs = /* @__PURE__ */ new Map();
  const order = [];
  const visit = (d, prefix) => {
    for (const s of d.systems ?? []) {
      if (!s.diagram) continue;
      const key = teamKey(s);
      if (designs.has(key)) continue;
      const path = prefix ? `${prefix}.${s.id}` : s.id;
      designs.set(key, { diagram: s.diagram, path, loc: s.loc });
      visit(s.diagram, path);
      order.push(key);
    }
  };
  visit(root, "");
  const send = (d, prefix, inbound) => {
    for (const s of d.systems ?? []) {
      if (!s.diagram) continue;
      const key = teamKey(s);
      const load = byFile.get(key) ?? { useCases: /* @__PURE__ */ new Map(), callers: [] };
      byFile.set(key, load);
      const rps = sentByUseCase(s, inbound.get(s.id) ?? /* @__PURE__ */ new Map(), load.useCases);
      if (rps > 0) load.callers.push({ path: prefix ? `${prefix}.${s.id}` : s.id, ...d.title !== void 0 ? { from: d.title } : {}, rps });
    }
  };
  send(root, "", rootInbound);
  for (const key of order.reverse()) {
    const { diagram, path, loc } = designs.get(key);
    if (!diagram.systems?.length) continue;
    const combined = withExtraTraffic(diagram, byFile.get(key)?.useCases ?? /* @__PURE__ */ new Map(), loc);
    send(diagram, path, inboundLoad(combined, resolveTraffic(combined)));
  }
  return { byFile, analyses: /* @__PURE__ */ new Map() };
}
function analyzeSystem(system, sent, options) {
  const contract = contractOf(system, options);
  const inbound = system.entries.map((e) => ({ entry: e.id, rps: sent.get(e.id) ?? 0 }));
  const totalInboundRps = inbound.reduce((sum, e) => sum + e.rps, 0);
  const result = { id: system.id, contract, inbound, totalInboundRps, utilization: 0, saturated: false, hot: false, breaches: [], entries: [], warnings: [] };
  const shared = system.diagram ? options.sharedSystems?.byFile.get(teamKey(system)) : void 0;
  const sending = inbound.filter((e) => e.rps > 0).map((e) => {
    const c = contract.entries.find((x) => x.entry === e.entry);
    const useCaseId = system.entries.find((x) => x.id === e.entry)?.useCaseId;
    const gets = useCaseId !== void 0 ? shared?.useCases.get(useCaseId) ?? 0 : 0;
    const rps = gets > e.rps * (1 + 1e-9) ? `${formatRps(e.rps).replace(/ rps$/, "")} of the ${formatRps(gets)} it gets` : formatRps(e.rps);
    return `${rps} into ${c?.useCase ? `"${c.useCase}" (${system.id}.${e.entry})` : `${system.id}.${e.entry}`}`;
  }).join(" and ");
  const label = `'${system.id}'`;
  if (contract.source === "stub") {
    const stub = system.stub;
    const rps = stub.rps ?? Infinity;
    result.utilization = Number.isFinite(rps) && rps > 0 ? totalInboundRps / rps : 0;
    result.saturated = result.utilization >= 1;
    result.hot = !result.saturated && result.utilization > HOT;
    const base = stub.latencyMs ?? (stub.p99Ms !== void 0 ? stub.p99Ms / (1 - SERVICE_SPREAD + SERVICE_SPREAD * tailFactor(0.99)) : 0);
    const hop = hopModel(base, 0);
    const at = (p) => hop.fixedMs + hop.tailMs * tailFactor(p);
    const availability2 = stub.availability !== void 0 ? stub.availability / 100 : 1;
    result.entries = system.entries.map((e) => ({ entry: e.id, p50Ms: at(0.5), p99Ms: at(0.99), availability: availability2 }));
    if (result.saturated) {
      result.warnings.push(`${label} cannot take what it is sent: you send ${sending}; it takes at most ${formatRps(rps)}.`);
      if (stub.p99Ms !== void 0) result.breaches.push({ requirement: `p99 < ${formatMs(stub.p99Ms)}`, message: `p99 is not held past ${formatRps(rps)}` });
    } else if (result.hot) result.warnings.push(`${label} runs hot under what it is sent: you send ${sending}; it runs hot past ${formatRps(rps * HOT)} and takes at most ${formatRps(rps)}.`);
    return result;
  }
  if (contract.source === "none" || !system.diagram) {
    result.entries = system.entries.map((e) => ({ entry: e.id, p50Ms: 0, p99Ms: 0, availability: 1 }));
    return result;
  }
  const team = system.diagram;
  const key = teamKey(system);
  const sentToTeam = shared?.useCases ?? /* @__PURE__ */ new Map();
  if (!shared) sentByUseCase(system, sent, sentToTeam);
  const sharedInboundRps = [...sentToTeam.values()].reduce((sum, rps) => sum + rps, 0);
  result.callers = shared?.callers ?? (totalInboundRps > 0 ? [{ path: system.id, rps: totalInboundRps }] : []);
  result.sharedInboundRps = sharedInboundRps;
  let cached2 = options.sharedSystems?.analyses.get(key);
  if (!cached2) {
    const combined = sharedInboundRps > 0 ? withExtraTraffic(team, sentToTeam, system.loc) : team;
    const nested = { timeoutMs: options.timeoutMs, ...options.sharedSystems ? { sharedSystems: options.sharedSystems } : {} };
    cached2 = { combined, analysis: sharedInboundRps > 0 ? analyze(combined, nested) : contract.baseline };
    options.sharedSystems?.analyses.set(key, cached2);
  }
  const { analysis } = cached2;
  result.analysis = analysis;
  result.overlay = analysisOverlay(cached2.combined, analysis);
  const busiest = analysis.nodes.reduce((best, n) => !best || n.utilization > best.utilization ? n : best, void 0);
  result.utilization = busiest?.utilization ?? 0;
  result.busiest = busiest?.id;
  result.saturated = !!busiest?.saturated;
  result.hot = !result.saturated && result.utilization > HOT;
  const byId = new Map(analysis.useCases.map((u) => [u.id, u]));
  result.entries = system.entries.map((e) => {
    const u = e.useCaseId !== void 0 ? byId.get(e.useCaseId) : void 0;
    return { entry: e.id, p50Ms: u?.percentiles.p50 ?? 0, p99Ms: u?.percentiles.p99 ?? 0, availability: u?.availability ?? 1 };
  });
  if (totalInboundRps === 0) return result;
  result.breaches = breachesOf(team, sentToTeam, analysis);
  const first = contract.entries.find((c) => inbound.some((e) => e.entry === c.entry && e.rps > 0));
  if (result.saturated && busiest) {
    const onOwn = first && first.saturatesAtRps === 0;
    const limit = first && Number.isFinite(first.saturatesAtRps) ? `; it takes at most ${formatRps(first.saturatesAtRps)} before its ${first.bottleneck} saturates` : "";
    result.warnings.push(
      onOwn ? `${label} is saturated on its own traffic, before what it is sent: its ${busiest.id} is at ${usageText(busiest)}.` : `${label} cannot take what it is sent: you send ${sending}${limit}. Its ${busiest.id} is at ${usageText(busiest)}.`
    );
  } else if (result.hot && busiest) {
    const limit = first && Number.isFinite(first.hotAtRps) ? `; it runs hot past ${formatRps(first.hotAtRps)}` : "";
    result.warnings.push(`${label} runs hot under what it is sent: you send ${sending}${limit}. Its ${busiest.id} is at ${usageText(busiest)}.`);
  }
  for (const b of result.breaches) result.warnings.push(`${label} breaks its SLA under what it is sent: ${b.message}.`);
  return result;
}
function withExtraTraffic(team, extra, loc) {
  const traffic = [...team.traffic ?? []];
  for (const [id, rps] of extra) {
    const u = team.useCases.find((x) => x.id === id);
    if (!u || rps <= 0) continue;
    const i = traffic.findIndex((t) => findUseCase(team, t.useCase) === u);
    if (i >= 0) traffic[i] = { ...traffic[i], rps: traffic[i].rps + rps };
    else traffic.push({ useCase: u.name, rps, loc });
  }
  return { ...team, traffic };
}
function breachesOf(team, sent, analysis) {
  const entered = /* @__PURE__ */ new Set();
  for (const [id, rps] of sent) {
    const u = team.useCases.find((x) => x.id === id);
    if (u && rps > 0) entered.add(u);
  }
  const nodes = new Map(analysis.nodes.map((n) => [n.id, n]));
  const results = new Map(analysis.useCases.map((u) => [u.id, u]));
  const breaches = [];
  for (const r of team.requirements ?? []) {
    if (r.kind !== "latency" && r.kind !== "availability") continue;
    const targets = r.useCase === void 0 ? [...entered] : [findUseCase(team, r.useCase)].filter((u) => !!u && entered.has(u));
    for (const u of targets) {
      const ua = results.get(u.id);
      const under = `under ${formatRps(ua.rps)}`;
      if (r.kind === "availability") {
        const name2 = `availability of "${u.name}" \u2265 ${r.minPercent}%`;
        if (ua.availability * 100 < r.minPercent - 1e-9) breaches.push({ requirement: name2, message: `availability of "${u.name}" is ${formatAvailability(ua.availability)} ${under} (limit ${r.minPercent}%)` });
        continue;
      }
      const key = PERCENTILE_KEYS[r.percentile];
      const scenario = r.scenario !== void 0 ? findScenario(u, r.scenario) : void 0;
      if (r.scenario !== void 0 && !scenario) continue;
      const what = `${key} of "${u.name}"${scenario ? ` scenario "${scenario.name}"` : ""}`;
      const name = `${what} < ${formatMs(r.maxMs)}`;
      const steps = scenario ? scenario.steps : u.scenarios.flatMap((s) => s.steps);
      const saturated = steps.map((s) => nodes.get(s.toServiceId)).reduce((best, n) => n?.saturated && (!best || n.utilization > best.utilization) ? n : best, void 0);
      if (saturated) {
        breaches.push({ requirement: name, message: `${what}: ${saturated.id} is saturated (${usageText(saturated)}) ${under} (limit ${formatMs(r.maxMs)})` });
        continue;
      }
      const ms = scenario ? ua.scenarios[u.scenarios.indexOf(scenario)].percentiles[key] : ua.percentiles[key];
      if (ms >= r.maxMs) breaches.push({ requirement: name, message: `${what} is ${formatMs(ms)} ${under} (limit ${formatMs(r.maxMs)})` });
    }
  }
  return breaches;
}

// ../frontend/src/sim/analyze.ts
function queueOf(inflow, drain) {
  const utilization = drain > 0 ? inflow / drain : inflow > 0 ? Infinity : 0;
  if (inflow >= drain && inflow > 0) return { inflowRps: inflow, drainRps: drain, utilization, backlogPerHour: (inflow - drain) * 3600, lagMs: Infinity };
  return { inflowRps: inflow, drainRps: drain, utilization, backlogPerHour: 0, lagMs: drain > 0 ? utilization / (drain - inflow) * 1e3 : 0 };
}
var DEFAULT_TIMEOUT_MS = 1e3;
var HOT = 0.7;
var QUEUE_CAP = 0.95;
var FAILOVER_SHARE = 0.1;
var SERVICE_SPREAD = 0.5;
var SECONDS_PER_MONTH = 2592e3;
var BYTES_PER_MB = 1e6;
var BYTES_PER_GB = 1e9;
var PERCENTILE_KEYS = { 50: "p50", 90: "p90", 95: "p95", 99: "p99", 99.9: "p999" };
var PERCENTILES2 = Object.keys(PERCENTILE_KEYS).map(Number);
function components(diagram) {
  return diagram.nodes.filter((n) => n.kind === "component");
}
var replicasOf = (node) => Math.max(1, node.replicas ?? 1);
function resolveTraffic(diagram, warnings = []) {
  const result = /* @__PURE__ */ new Map();
  for (const u of diagram.useCases) result.set(u.id, { rps: 0, shares: u.scenarios.map((_, i) => i === 0 ? 1 : 0) });
  const seen = /* @__PURE__ */ new Set();
  for (const entry of diagram.traffic ?? []) {
    const useCase = findUseCase(diagram, entry.useCase);
    if (!useCase) {
      warnings.push(`Traffic for unknown use case "${entry.useCase}" is ignored`);
      continue;
    }
    if (seen.has(useCase.id)) continue;
    seen.add(useCase.id);
    const shares = useCase.scenarios.map(() => 0);
    for (const { scenario, share: share2 } of entry.mix ?? []) {
      const found = findScenario(useCase, scenario);
      if (found) shares[useCase.scenarios.indexOf(found)] += share2;
      else warnings.push(`"${useCase.name}" has no scenario "${scenario}"; its traffic share is ignored`);
    }
    const total = shares.reduce((a, b) => a + b, 0);
    if (total <= 0) shares[0] = 1;
    else {
      if (Math.abs(total - 1) > 1e-6) warnings.push(`Traffic mix of "${useCase.name}" adds up to ${formatPercent(total)}; shares are scaled to 100%`);
      for (let i = 0; i < shares.length; i++) shares[i] /= total;
    }
    const average = entry.avgRps === void 0 ? void 0 : entry.rps > 0 ? entry.avgRps / entry.rps : 1;
    result.set(useCase.id, { rps: entry.rps, shares: useCase.scenarios.length ? shares : [], ...average !== void 0 ? { average } : {} });
  }
  return result;
}
function trafficFor(diagram, options = {}, warnings = []) {
  const traffic = resolveTraffic(diagram, warnings);
  for (const [id, rps] of options.trafficRps ?? []) {
    const t = traffic.get(id);
    if (t) t.rps = Math.max(0, rps);
  }
  const hits = hitRatesOf(diagram, options);
  if (hits.size) {
    const kinds = new Map(diagram.nodes.map((n) => [n.id, kindOf(n)]));
    const access = accessIn(diagram);
    for (const u of diagram.useCases) {
      if (diagram.traffic?.some((e) => e.mix?.length && findUseCase(diagram, e.useCase) === u)) continue;
      const lookups = cacheLookups(u, hits, (id) => kinds.get(id), (step) => access(step) === "read");
      const miss = missFactors(lookups);
      if (miss.size) traffic.set(u.id, { ...traffic.get(u.id), miss, lookups });
    }
  }
  const retries = retriesOf(diagram, options);
  if (retries.size) {
    for (const u of diagram.useCases) {
      const retry = /* @__PURE__ */ new Map();
      for (const s of u.scenarios) for (const step of s.steps) if (!step.failed && retries.has(step.toServiceId)) retry.set(step, retries.get(step.toServiceId).attempts);
      if (retry.size) traffic.set(u.id, { ...traffic.get(u.id), retry });
    }
  }
  const failed = options.failed;
  if (!failed?.size) return traffic;
  for (const u of diagram.useCases) {
    const t = traffic.get(u.id);
    const down = (s) => pathNodes(u, s).filter((id) => failed.has(id));
    const shares = [...t.shares];
    let stranded = 0;
    u.scenarios.forEach((s, i) => {
      if (!(shares[i] > 0)) return;
      const ids = down(s);
      if (ids.length === 0) return;
      const targets = u.scenarios.filter((f) => f.outcome === "success" && down(f).length === 0 && ids.every((id) => fallbacksFor(u, id).includes(f)));
      if (targets.length === 0) {
        stranded += shares[i];
        return;
      }
      const indexes = targets.map((f) => u.scenarios.indexOf(f));
      const weight = indexes.reduce((sum, j) => sum + t.shares[j], 0);
      for (const j of indexes) shares[j] += shares[i] * (weight > 0 ? t.shares[j] / weight : 1 / indexes.length);
      shares[i] = 0;
    });
    traffic.set(u.id, { ...t, shares, stranded: Math.min(1, stranded) });
  }
  return traffic;
}
function hitRatesOf(diagram, options) {
  const hits = /* @__PURE__ */ new Map();
  for (const o of diagram.capacity ?? []) if (o.hitPercent !== void 0) hits.set(o.node, o.hitPercent);
  for (const [id, percent] of options.hitRates ?? []) hits.set(id, percent);
  return hits;
}
var expectedAttempts = (e, retries) => {
  let sum = 0;
  for (let k = 0; k <= retries; k++) sum += e ** k;
  return sum;
};
function retriesOf(diagram, options = {}) {
  const out = /* @__PURE__ */ new Map();
  const set = (id, percent, retries) => {
    const e = Math.min(100, Math.max(0, percent)) / 100;
    out.set(id, { errorRate: e, retries, attempts: expectedAttempts(e, retries), success: 1 - e ** (retries + 1) });
  };
  const declared = new Map((diagram.capacity ?? []).map((o) => [o.node, o]));
  for (const o of diagram.capacity ?? []) if (o.errorPercent !== void 0) set(o.node, o.errorPercent, o.retries ?? 0);
  for (const [id, percent] of options.errorRates ?? []) set(id, percent, declared.get(id)?.retries ?? 0);
  return out;
}
function retryVariants(hops, retries) {
  let out = [{ share: 1, hops }];
  hops.forEach(
    (part, p) => part.forEach((h2, i) => {
      const r = retries.get(h2.target);
      if (!r || h2.failed || r.retries === 0 || r.errorRate <= 0) return;
      const next = [];
      for (const v of out) {
        for (let k = 0; k <= r.retries; k++) {
          const share2 = v.share * (k < r.retries ? r.errorRate ** k * (1 - r.errorRate) : r.errorRate ** k);
          if (share2 <= 0) continue;
          if (k === 0) {
            next.push({ share: share2, hops: v.hops });
            continue;
          }
          const changed = v.hops.map((q, j) => j === p ? q.map((x, n) => n === i ? { ...x, attempts: k + 1 } : x) : q);
          next.push({ share: share2, hops: changed });
        }
      }
      out = next;
      if (out.length > MAX_RETRY_VARIANTS) {
        out = out.map((v, n) => ({ v, n })).sort((a, b) => b.v.share - a.v.share || a.n - b.n).slice(0, MAX_RETRY_VARIANTS).map(({ v }) => v);
        const total = out.reduce((sum, v) => sum + v.share, 0);
        out = out.map((v) => ({ ...v, share: v.share / total }));
      }
    })
  );
  return out;
}
var MAX_RETRY_VARIANTS = 256;
var BACKING_STORES = ["database", "search", "analytics", "storage"];
function cacheLookups(useCase, hits, kindOf2, isRead) {
  return useCase.scenarios.map((s) => {
    const lookups = [];
    s.steps.forEach((lookup, i) => {
      const hit = hits.get(lookup.toServiceId);
      if (hit === void 0 || lookup.failed || !isRead(lookup)) return;
      const caller = lookup.fromServiceId;
      const reached = /* @__PURE__ */ new Set([lookup.toServiceId]);
      const miss = /* @__PURE__ */ new Set();
      for (const step of s.steps.slice(i + 1)) {
        const fill2 = miss.size > 0 && step.fromServiceId === caller && step.toServiceId === lookup.toServiceId && !isRead(step);
        const fallsThrough = reached.has(step.fromServiceId) || step.fromServiceId === caller && isRead(step) && BACKING_STORES.includes(kindOf2(step.toServiceId));
        if (fill2) miss.add(step);
        if (!fallsThrough || step.toServiceId === caller) continue;
        reached.add(step.toServiceId);
        miss.add(step);
      }
      if (miss.size) lookups.push({ hit: Math.min(100, Math.max(0, hit)) / 100, miss });
    });
    return lookups;
  });
}
function missFactors(lookups) {
  const factors = /* @__PURE__ */ new Map();
  for (const l of lookups.flat()) for (const step of l.miss) factors.set(step, (factors.get(step) ?? 1) * (1 - l.hit));
  return factors;
}
function cacheVariants(hops, lookups) {
  const out = [];
  const n = Math.min(lookups.length, 10);
  for (let mask = 0; mask < 1 << n; mask++) {
    let share2 = 1;
    const skipped = /* @__PURE__ */ new Set();
    for (let k = 0; k < n; k++) {
      const hit = mask >> k & 1;
      share2 *= hit ? lookups[k].hit : 1 - lookups[k].hit;
      if (hit) for (const step of lookups[k].miss) skipped.add(step);
    }
    if (share2 <= 0) continue;
    out.push({ share: share2, hops: hops.map((part) => part.filter((h2) => !skipped.has(h2.step))).filter((part) => part.length) });
  }
  return out;
}
function averageTraffic(traffic) {
  if (![...traffic.values()].some((t) => t.average !== void 0)) return traffic;
  return new Map([...traffic].map(([id, t]) => [id, t.average === void 0 ? t : { ...t, rps: t.rps * t.average }]));
}
var multiplierOf = (step) => step.multiplier !== void 0 && step.multiplier > 0 ? step.multiplier : 1;
var opLatencyOf = (step) => step.op?.latency !== void 0 && step.op.latency > 0 ? step.op.latency : 1;
var opCostOf = (step) => step.op?.cost !== void 0 && step.op.cost > 0 ? step.op.cost : 1;
function forEachStepRate(diagram, traffic, visit) {
  for (const u of diagram.useCases) {
    const { rps, shares, miss, retry } = traffic.get(u.id) ?? { rps: 0, shares: [] };
    u.scenarios.forEach((s, i) => {
      const rate = rps * (shares[i] ?? 0);
      if (!(rate > 0)) return;
      for (const step of s.steps) {
        if (step.failed) continue;
        const r = miss?.has(step) ? rate * miss.get(step) : rate;
        visit(step, retry?.has(step) ? r * retry.get(step) : r, u);
      }
    });
  }
}
function computeLoad(diagram, traffic) {
  const load = /* @__PURE__ */ new Map();
  const access = accessIn(diagram);
  forEachStepRate(diagram, traffic, (step, rate) => {
    const entry = load.get(step.toServiceId) ?? { read: 0, write: 0 };
    entry[access(step)] += rate * multiplierOf(step) * opCostOf(step);
    load.set(step.toServiceId, entry);
  });
  return load;
}
var payloadDirection = (step, access) => access === "read" ? { from: step.toServiceId, to: step.fromServiceId } : { from: step.fromServiceId, to: step.toServiceId };
var OUTSIDE = (kind) => kind === "client" || kind === "external";
function computeEgressGb(diagram, traffic, kindOf2 = (id) => profileOfId(diagram, id)) {
  const gb = /* @__PURE__ */ new Map();
  const access = accessIn(diagram);
  forEachStepRate(diagram, traffic, (step, rate) => {
    if (!step.sizeBytes || step.sizeBytes <= 0) return;
    const { from, to } = payloadDirection(step, access(step));
    if (OUTSIDE(kindOf2(from)) || !OUTSIDE(kindOf2(to))) return;
    gb.set(from, (gb.get(from) ?? 0) + rate * multiplierOf(step) * step.sizeBytes * SECONDS_PER_MONTH / BYTES_PER_GB);
  });
  return gb;
}
var BANDWIDTH_BOUND = (kind) => !["client", "external", "dns", "other", "storage", "cdn"].includes(kind);
function computeBytesPerSecond(diagram, traffic) {
  const bytes = /* @__PURE__ */ new Map();
  forEachStepRate(diagram, traffic, (step, rate) => {
    if (!step.sizeBytes || step.sizeBytes <= 0) return;
    const b = rate * multiplierOf(step) * step.sizeBytes;
    for (const id of /* @__PURE__ */ new Set([step.fromServiceId, step.toServiceId])) bytes.set(id, (bytes.get(id) ?? 0) + b);
  });
  return bytes;
}
function profileOfId(diagram, id) {
  const node = diagram.nodes.find((n) => n.id === id);
  return node ? profileOf(node).kind : "client";
}
function transferMs(step, bandwidthOf) {
  if (!step.sizeBytes || step.sizeBytes <= 0) return 0;
  const mbps = Math.min(bandwidthOf(step.fromServiceId), bandwidthOf(step.toServiceId));
  return mbps > 0 && Number.isFinite(mbps) ? multiplierOf(step) * step.sizeBytes / BYTES_PER_MB / mbps * 1e3 : 0;
}
var utilizationOf = (load, capacity) => Number.isFinite(capacity) && capacity > 0 ? load / capacity : 0;
function erlangC(servers, rho) {
  if (rho <= 0) return 0;
  if (rho >= 1) return 1;
  const c = Math.max(1, Math.round(servers));
  const a = c * rho;
  let b = 1;
  for (let k = 1; k <= c; k++) b = a * b / (k + a * b);
  return b / (1 - rho * (1 - b));
}
function hopModel(baseMs, rho, servers = 1) {
  const r = Math.min(Math.max(rho, 0), QUEUE_CAP);
  const c = Math.max(1, Math.round(servers));
  const waitProbability = erlangC(c, r);
  const meanMs = baseMs + waitProbability * baseMs / (c * (1 - r));
  const fixedMs = (1 - SERVICE_SPREAD) * baseMs;
  return { fixedMs, tailMs: meanMs - fixedMs, waitProbability };
}
var hopMean = (h2) => h2.fixedMs + h2.tailMs;
var tailFactor = (p) => -Math.log(1 - p);
var replicatedAvailability = (a, replicas) => 1 - (1 - a) ** replicas;
var primaryAvailability = (a, replicas) => replicas >= 2 ? 1 - (1 - a) * FAILOVER_SHARE : a;
function usageOf(p, replicas, readLoadRps, writeLoadRps, bytesPerSecond = 0) {
  const { readRps: readCapacityRps, writeRps: writeCapacityRps } = capacityOf(p, replicas);
  const readUtilization = utilizationOf(readLoadRps, readCapacityRps);
  const writeUtilization = utilizationOf(writeLoadRps, writeCapacityRps);
  const requestUtilization = combinedUtilization(p, readUtilization, writeUtilization);
  const loadRps = readLoadRps + writeLoadRps;
  const bound = BANDWIDTH_BOUND(p.kind);
  const bandwidthLoadMBps = bound ? bytesPerSecond / BYTES_PER_MB : 0;
  const bandwidthCapacityMBps = bound ? p.bandwidthMBps * replicas * p.shards : 0;
  const bandwidthUtilization = utilizationOf(bandwidthLoadMBps, bandwidthCapacityMBps);
  const utilization = Math.max(requestUtilization, bandwidthUtilization);
  return {
    loadRps,
    capacityRps: readCapacityRps === writeCapacityRps || requestUtilization === 0 ? readCapacityRps : loadRps / requestUtilization,
    utilization,
    requestUtilization,
    saturated: utilization >= 1,
    readLoadRps,
    writeLoadRps,
    readCapacityRps,
    writeCapacityRps,
    readUtilization,
    writeUtilization,
    bandwidthLoadMBps,
    bandwidthCapacityMBps,
    bandwidthUtilization,
    writeScaling: p.writeScaling
  };
}
var bandwidthBound = (n) => n.bandwidthUtilization > n.requestUtilization;
var serversOf = (n, replicas) => writeBound(n) ? 1 : replicas;
function usageText(n) {
  const part = (load, capacity, rho) => `${formatRps(load)} of ${formatRps(capacity)}, ${formatPercent(rho)}`;
  if (bandwidthBound(n)) {
    const mb = (x) => `${Number(x.toPrecision(3)).toLocaleString("en-US")} MB/s`;
    return `bandwidth ${mb(n.bandwidthLoadMBps)} of ${mb(n.bandwidthCapacityMBps)}, ${formatPercent(n.bandwidthUtilization)}`;
  }
  if (n.writeScaling === "shards" && n.writeLoadRps > 0) {
    if (n.readLoadRps <= 0) return `writes ${part(n.writeLoadRps, n.writeCapacityRps, n.writeUtilization)}`;
    return `reads ${part(n.readLoadRps, n.readCapacityRps, n.readUtilization)}; writes ${part(n.writeLoadRps, n.writeCapacityRps, n.writeUtilization)}`;
  }
  return part(n.loadRps, n.capacityRps, n.requestUtilization);
}
var writeBound = (n) => n.writeScaling === "shards" && n.writeUtilization >= n.readUtilization && n.writeLoadRps > 0;
function pathMean(path) {
  return path.parts.reduce((sum, part) => sum + Math.max(0, ...part.map((i) => i.fixedMs + i.tailMs)), 0);
}
function pathAt(path, l) {
  let sum = 0;
  for (const part of path.parts) {
    let most = 0;
    for (const i of part) most = Math.max(most, i.fixedMs + i.tailMs * l);
    sum += most;
  }
  return sum;
}
var pathQuantile = (path, p) => pathAt(path, tailFactor(p));
function pathCdf(path, t) {
  if (pathAt(path, 0) > t) return 0;
  if (path.parts.every((part) => part.length <= 1)) {
    let fixed = 0;
    let tail = 0;
    for (const part of path.parts) {
      if (part.length) {
        fixed += part[0].fixedMs;
        tail += part[0].tailMs;
      }
    }
    if (tail <= 0) return 1;
    const l = (t - fixed) / tail;
    return l > 1e6 ? 1 : 1 - Math.exp(-l);
  }
  let hi = 1;
  while (pathAt(path, hi) <= t) {
    hi *= 2;
    if (hi > 1e6) return 1;
  }
  let lo = 0;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (pathAt(path, mid) <= t) lo = mid;
    else hi = mid;
  }
  return 1 - Math.exp(-lo);
}
function mixtureQuantile(paths, q) {
  const live = paths.filter((s) => s.share > 0);
  if (live.length === 0) return 0;
  if (live.length === 1) return pathQuantile(live[0].path, q);
  const total = live.reduce((sum, s) => sum + s.share, 0);
  const cdf = (t) => live.reduce((sum, s) => sum + s.share * pathCdf(s.path, t), 0) / total;
  let lo = Math.min(...live.map((s) => pathQuantile(s.path, 0)));
  let hi = Math.max(...live.map((s) => pathQuantile(s.path, q)));
  for (let i = 0; i < 60 && hi - lo > 1e-9 * Math.max(1, hi); i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) >= q) hi = mid;
    else lo = mid;
  }
  return hi;
}
function mainScenarioIndex(shares) {
  let best = 0;
  shares.forEach((share2, i) => {
    if (share2 > shares[best]) best = i;
  });
  return best;
}
function profilesOf(diagram, warnings = []) {
  const nodes = components(diagram);
  const ids = new Set(nodes.map((n) => n.id));
  const overrides = new Map((diagram.capacity ?? []).map((o) => [o.node, o]));
  for (const o of diagram.capacity ?? []) if (!ids.has(o.node)) warnings.push(`Capacity for unknown node '${o.node}' is ignored`);
  return new Map(nodes.map((n) => [n.id, profileOf(n, overrides.get(n.id))]));
}
function analyze(diagram, options = {}) {
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const warnings = [];
  const nodes = components(diagram);
  const profiles = profilesOf(diagram, warnings);
  const kindOf2 = (id) => profiles.get(id)?.kind ?? "client";
  const traffic = trafficFor(diagram, options, warnings);
  const retries = retriesOf(diagram, options);
  const drains = new Map((diagram.capacity ?? []).flatMap((o) => o.drainRps !== void 0 ? [[o.node, o.drainRps]] : []));
  const load = computeLoad(diagram, traffic);
  const egress = computeEgressGb(diagram, averageTraffic(traffic), kindOf2);
  const bytes = computeBytesPerSecond(diagram, traffic);
  const systems = diagram.systems?.length ? analyzeSystems(diagram, traffic, options) : void 0;
  const hops = /* @__PURE__ */ new Map();
  const nodeResults = nodes.map((n) => {
    const p = profiles.get(n.id);
    const replicas = Math.max(1, options.replicas?.get(n.id) ?? replicasOf(n));
    const { read: read2, write } = load.get(n.id) ?? { read: 0, write: 0 };
    const usage = usageOf(p, replicas, read2, write, bytes.get(n.id) ?? 0);
    const servers = serversOf(usage, replicas);
    const hop = hopModel(p.latencyMs, usage.utilization, servers);
    hops.set(n.id, hop);
    const egressGbPerMonth = egress.get(n.id) ?? 0;
    const egressUsd = egressGbPerMonth * p.egressUsdPerGb;
    const down = options.failed?.has(n.id) ?? false;
    const availability2 = down ? 0 : replicatedAvailability(p.availability, replicas);
    return {
      id: n.id,
      kind: p.kind,
      replicas,
      shards: p.shards,
      ...usage,
      ...p.consistency ? { consistency: p.consistency } : {},
      servers,
      waitProbability: hop.waitProbability,
      latencyMs: hopMean(hop),
      availability: availability2,
      writeAvailability: down ? 0 : p.writeScaling === "shards" ? primaryAvailability(p.availability, replicas) : availability2,
      costUsd: replicas * p.shards * p.costUsd + egressUsd,
      egressGbPerMonth,
      egressUsd,
      durable: p.durable,
      ...down ? { failed: true } : {},
      ...drains.has(n.id) ? { queue: queueOf(read2 + write, drains.get(n.id)) } : {},
      ...retries.has(n.id) ? { retry: { ...retries.get(n.id), stormRisk: usage.utilization >= HOT && retries.get(n.id).retries > 0 && retries.get(n.id).errorRate > 0 } } : {}
    };
  });
  const nodeById = new Map(nodeResults.map((n) => [n.id, n]));
  const bandwidthOf = (id) => profiles.get(id)?.bandwidthMBps ?? Infinity;
  const timeoutOf = (id) => profiles.get(id)?.timeoutMs ?? defaultTimeoutMs;
  for (const n of nodeResults) {
    const usage = usageText(n);
    if (n.saturated) warnings.push(`'${n.id}' is saturated: ${usage}. ${writeBound(n) ? "Add shards for writes" : "Add replicas"} or take load off it.`);
    else if (n.utilization > HOT) warnings.push(`'${n.id}' runs hot: ${usage}.`);
  }
  for (const n of nodeResults) {
    if (!n.queue || n.queue.backlogPerHour <= 0) continue;
    warnings.push(
      `'${n.id}' falls behind: ${formatRps(n.queue.inflowRps)} flows in and its consumers drain ${formatRps(n.queue.drainRps)}, so the backlog grows by ${formatCount(n.queue.backlogPerHour)} messages an hour. Drain faster or send it less.`
    );
  }
  for (const n of nodeResults) {
    if (!n.retry?.stormRisk) continue;
    const { errorRate, retries: r } = n.retry;
    warnings.push(
      `'${n.id}' risks a retry storm: it runs at ${formatPercent(n.utilization)} with ${formatPercent(errorRate)} errors and ${r} ${r === 1 ? "retry" : "retries"}. Once it saturates, more calls fail and each comes back up to ${r} more times, up to ${formatRps(n.loadRps / n.retry.attempts * (r + 1))}. Add capacity, retry less, or back off.`
    );
  }
  for (const s of systems?.systems ?? []) warnings.push(...s.warnings);
  const access = accessIn(diagram);
  const pathOf = (hopsOfPath) => ({
    parts: hopsOfPath.map(
      (part) => part.map((h2) => {
        if (h2.failed) return { fixedMs: timeoutOf(h2.target), tailMs: 0 };
        const hop = systems?.hop(h2.target, h2.step.toPort) ?? hops.get(h2.target) ?? { fixedMs: 0, tailMs: 0 };
        const op = opLatencyOf(h2.step);
        const item = { fixedMs: transferMs(h2.step, bandwidthOf) + hop.fixedMs * op, tailMs: hop.tailMs * op };
        return h2.attempts === void 0 ? item : { fixedMs: item.fixedMs * h2.attempts, tailMs: item.tailMs * h2.attempts };
      })
    )
  });
  const useCases = diagram.useCases.map((u) => {
    const { rps, shares, stranded, average, lookups, retry } = traffic.get(u.id);
    const availabilityOf = (id, writes2) => {
      const n = nodeById.get(id);
      if (!n && systems) return systemAvailability(u, id, systems.availability);
      return !n ? 1 : writes2.has(id) ? n.writeAvailability : n.availability;
    };
    const withRetries = (writes2) => (id) => retries.has(id) ? availabilityOf(id, writes2) * retries.get(id).success : availabilityOf(id, writes2);
    if (lookups || retry) {
      const { scenarios: scenarios2, percentiles: percentiles2, tailScenario: tailScenario2 } = cachedLatency(u, shares, lookups ?? [], retry ? retries : /* @__PURE__ */ new Map(), pathOf, new Set(options.percentiles ?? PERCENTILES2));
      const writes2 = mainWrites(u, shares, (step) => access(step) === "write");
      const availability3 = useCaseAvailability(u, shares, retries.size ? withRetries(writes2) : (id) => availabilityOf(id, writes2)) * (1 - (stranded ?? 0));
      return { id: u.id, name: u.name, rps, ...average !== void 0 ? { avgRps: rps * average } : {}, scenarios: scenarios2, percentiles: percentiles2, tailScenario: tailScenario2, availability: availability3 };
    }
    const paths = u.scenarios.map((s) => pathOf(criticalPath(u, s)));
    const scenarios = u.scenarios.map((s, i) => ({
      id: s.id,
      name: s.name,
      share: shares[i] ?? 0,
      meanMs: pathMean(paths[i]),
      percentiles: Object.fromEntries(PERCENTILES2.map((q) => [PERCENTILE_KEYS[q], pathQuantile(paths[i], q / 100)]))
    }));
    const weighted = paths.map((path, i) => ({ share: shares[i] ?? 0, path }));
    const wanted = new Set(options.percentiles ?? PERCENTILES2);
    const percentiles = Object.fromEntries(PERCENTILES2.map((q) => [PERCENTILE_KEYS[q], wanted.has(q) ? mixtureQuantile(weighted, q / 100) : NaN]));
    const tailScenario = Object.fromEntries(
      PERCENTILES2.map((q) => {
        if (!wanted.has(q)) return [PERCENTILE_KEYS[q], 0];
        const t = percentiles[PERCENTILE_KEYS[q]];
        const above = weighted.map((s) => s.share > 0 ? s.share * (1 - pathCdf(s.path, t * (1 - 1e-9))) : -1);
        return [PERCENTILE_KEYS[q], Math.max(0, above.indexOf(Math.max(...above)))];
      })
    );
    if (rps > 0 && u.scenarios.length === 0) warnings.push(`"${u.name}" has traffic but no steps`);
    const writes = mainWrites(u, shares, (step) => access(step) === "write");
    const availability2 = useCaseAvailability(u, shares, retries.size ? withRetries(writes) : (id) => availabilityOf(id, writes)) * (1 - (stranded ?? 0));
    return { id: u.id, name: u.name, rps, ...average !== void 0 ? { avgRps: rps * average } : {}, scenarios, percentiles, tailScenario, availability: availability2 };
  });
  return {
    nodes: nodeResults,
    useCases,
    totalCostUsd: nodeResults.reduce((sum, n) => sum + n.costUsd, 0),
    totalEgressUsd: nodeResults.reduce((sum, n) => sum + n.egressUsd, 0),
    singlePointsOfFailure: singlePointsOfFailure(diagram),
    warnings,
    ...systems ? { systems: systems.systems } : {}
  };
}
function cachedLatency(u, shares, lookups, retries, pathOf, wanted) {
  const variants = u.scenarios.map(
    (s, i) => cacheVariants(criticalPath(u, s), lookups[i] ?? []).flatMap(
      (v) => retries.size ? retryVariants(v.hops, retries).map((r) => ({ share: v.share * r.share, path: pathOf(r.hops) })) : [{ share: v.share, path: pathOf(v.hops) }]
    )
  );
  const scenarios = u.scenarios.map((s, i) => ({
    id: s.id,
    name: s.name,
    share: shares[i] ?? 0,
    meanMs: variants[i].reduce((sum, v) => sum + v.share * pathMean(v.path), 0),
    percentiles: Object.fromEntries(PERCENTILES2.map((q) => [PERCENTILE_KEYS[q], mixtureQuantile(variants[i], q / 100)]))
  }));
  const weighted = variants.flatMap((vs, i) => vs.map((v) => ({ share: (shares[i] ?? 0) * v.share, path: v.path })));
  const percentiles = Object.fromEntries(PERCENTILES2.map((q) => [PERCENTILE_KEYS[q], wanted.has(q) ? mixtureQuantile(weighted, q / 100) : NaN]));
  const tailScenario = Object.fromEntries(
    PERCENTILES2.map((q) => {
      if (!wanted.has(q)) return [PERCENTILE_KEYS[q], 0];
      const t = percentiles[PERCENTILE_KEYS[q]];
      const above = variants.map((vs, i) => (shares[i] ?? 0) > 0 ? vs.reduce((sum, v) => sum + (shares[i] ?? 0) * v.share * (1 - pathCdf(v.path, t * (1 - 1e-9))), 0) : -1);
      return [PERCENTILE_KEYS[q], Math.max(0, above.indexOf(Math.max(...above)))];
    })
  );
  return { scenarios, percentiles, tailScenario };
}
function systemAvailability(u, id, availability2) {
  let result = 1;
  for (const s of u.scenarios) for (const step of s.steps) if (step.toServiceId === id) result = Math.min(result, availability2(id, step.toPort) ?? 1);
  return result;
}
function mainWrites(useCase, shares, isWrite) {
  if (useCase.scenarios.length === 0) return /* @__PURE__ */ new Set();
  const path = criticalPath(useCase, useCase.scenarios[mainScenarioIndex(shares)]).flat();
  return new Set(path.filter((h2) => !h2.failed && !h2.async && isWrite(h2.step)).map((h2) => h2.target));
}
function useCaseAvailability(useCase, shares, availabilityOf) {
  if (useCase.scenarios.length === 0) return 1;
  const main = pathNodes(useCase, useCase.scenarios[mainScenarioIndex(shares)]);
  const onMain = new Set(main);
  let result = 1;
  for (const id of main) {
    const a = availabilityOf(id);
    const fallback = Math.max(
      0,
      ...fallbacksFor(useCase, id).map(
        (s) => pathNodes(useCase, s).filter((other) => other !== id && !onMain.has(other)).reduce((product, other) => product * availabilityOf(other), 1)
      )
    );
    result *= 1 - (1 - a) * (1 - fallback);
  }
  return result;
}
var DEPLOYED = (kind) => kind !== "client" && kind !== "other" && kind !== "external" && kind !== "dns";
function singlePointsOfFailure(diagram) {
  return components(diagram).filter((n) => replicasOf(n) === 1 && DEPLOYED(profileOf(n).kind)).filter((n) => diagram.useCases.some((u) => needs(u, n.id) && fallbacksFor(u, n.id).length === 0)).map((n) => n.id);
}

// ../frontend/src/sim/cost.ts
function ancestors(byId, node) {
  const out = [];
  for (let p = node.parent ? byId.get(node.parent) : void 0; p && !out.includes(p); p = p.parent ? byId.get(p.parent) : void 0) out.push(p);
  return out;
}
function covers(byId, node, scope2) {
  if ("team" in scope2) return node.ownerTeam === scope2.team;
  const outer = ancestors(byId, node);
  if ("tag" in scope2) return node.tag === scope2.tag || outer.some((g) => g.tag === scope2.tag);
  return outer.some((g) => g.id === scope2.group);
}
function scopedCost(diagram, analysis, scope2) {
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const nodes = analysis.nodes.filter((n) => {
    const node = byId.get(n.id);
    return node !== void 0 && covers(byId, node, scope2);
  });
  const id = "team" in scope2 ? `@${scope2.team}` : "tag" in scope2 ? `.${scope2.tag}` : scope2.group;
  const label = "team" in scope2 ? id : "tag" in scope2 ? diagram.legend?.find((e) => e.id === scope2.tag)?.label ?? id : byId.get(scope2.group)?.name ?? id;
  return share(id, label, nodes);
}
function share(id, label, nodes) {
  const sorted = [...nodes].sort((a, b) => b.costUsd - a.costUsd || a.id.localeCompare(b.id));
  return {
    id,
    label,
    costUsd: sorted.reduce((sum, n) => sum + n.costUsd, 0),
    egressUsd: sorted.reduce((sum, n) => sum + n.egressUsd, 0),
    nodes: sorted.map((n) => n.id)
  };
}

// ../frontend/src/sim/tests.ts
var pass = (message) => ({ passed: true, message });
var fail = (message, hint, fix) => ({ passed: false, message, hint, ...fix ? { fix } : {} });
function makeRun(diagram, analysis, options = {}) {
  const access = accessIn(diagram);
  return {
    diagram,
    analysis,
    nodes: new Map(analysis.nodes.map((n) => [n.id, n])),
    useCases: new Map(analysis.useCases.map((u) => [u.id, u])),
    shares: new Map([...trafficFor(diagram, options)].map(([id, t]) => [id, t.shares])),
    profiles: profilesOf(diagram),
    isWrite: (step) => access(step) === "write",
    options
  };
}
function runTests(diagram, analysis = analyze(diagram), options = {}) {
  const run = makeRun(diagram, analysis, options);
  const results = (diagram.requirements ?? []).map((r, i) => {
    const { passed, message, hint } = requirement(run, r);
    return { id: `req:${i + 1}`, name: requirementName(r), category: CATEGORY[r.kind], passed, message, hint, loc: r.loc };
  });
  results.push(...systemResults(diagram, analysis));
  const names = /* @__PURE__ */ new Map();
  for (const test of diagram.tests ?? []) {
    const n = (names.get(test.name) ?? 0) + 1;
    names.set(test.name, n);
    results.push({ id: n === 1 ? `test:${test.name}` : `test:${test.name}#${n}`, name: test.name, category: "flow", ...flowTest(run, test), loc: test.loc });
  }
  return results.map(({ hint, ...r }) => r.passed || !hint ? r : { ...r, hint });
}
function systemResults(diagram, analysis) {
  return (analysis.systems ?? []).filter((s) => s.totalInboundRps > 0 && s.contract.source !== "none").map((s) => {
    const system = diagram.systems?.find((x) => x.id === s.id);
    const node = diagram.nodes.find((n) => n.id === s.id);
    const team = node?.ownerTeam ? `the ${node.ownerTeam} team` : `the owners of ${s.id}`;
    const problem = s.warnings.find((w) => !w.includes(" runs hot "));
    const sat = s.contract.entries.find((e) => s.inbound.some((i) => i.entry === e.entry && i.rps > 0));
    const room = sat && Number.isFinite(sat.saturatesAtRps) ? `; it takes at most ${formatRps(sat.saturatesAtRps)}` : "";
    const bottleneck = s.saturated && s.busiest ? ` (their bottleneck is ${s.busiest})` : "";
    return {
      id: `system:${s.id}`,
      name: `${s.id} takes what it is sent`,
      category: s.breaches.some((b) => b.requirement.startsWith("availability")) && !s.saturated ? "availability" : "latency",
      passed: !problem,
      message: problem ?? `'${s.id}' takes ${formatRps(s.totalInboundRps)}${(s.sharedInboundRps ?? 0) > s.totalInboundRps * (1 + 1e-9) ? ` (of the ${formatRps(s.sharedInboundRps)} it gets)` : ""}${s.contract.source === "stub" ? "" : " on top of its own traffic"} and holds its requirements${room}`,
      ...problem ? { hint: `Send it less, or ask ${team} to add capacity for it${bottleneck}` } : {},
      ...system ? { loc: system.loc } : {}
    };
  });
}
var CATEGORY = {
  latency: "latency",
  availability: "availability",
  durable: "durability",
  survive: "resilience",
  cost: "cost",
  lag: "latency"
};
var percentileName = (q) => PERCENTILE_KEYS[q];
var lineOf = (loc) => `${loc.file ? `${loc.file}:` : "line "}${loc.line}`;
function stepText(step) {
  const arrow = step.failed ? "-x" : step.executionType === "SYNC_REQUEST_RESPONSE" ? "->" : "->>";
  const label = requestLabel(step);
  return `${step.fromServiceId} ${arrow} ${step.toServiceId}${label ? ` : ${label}` : ""} at ${lineOf(step.loc)}`;
}
function requirementName(r) {
  switch (r.kind) {
    case "latency":
      return `${percentileName(r.percentile)} of ${r.useCase ?? "every use case"}${r.scenario !== void 0 ? ` scenario ${r.scenario}` : ""} < ${formatMs(r.maxMs)}`;
    case "availability":
      return `availability of ${r.useCase ?? "every use case"} \u2265 ${r.minPercent}%`;
    case "durable":
      return `${r.useCase} is durable`;
    case "survive":
      return r.target === "any" ? "survive any node failure" : `survive failure of ${selectorText(r.target)}`;
    case "cost":
      return `cost${r.scope ? ` of ${scopeText(r.scope)}` : ""} \u2264 ${formatUsd(r.maxUsdPerMonth)}`;
    case "lag":
      return `lag of ${r.useCase} < ${formatDuration(r.maxMs)}`;
  }
}
function requirement(run, r) {
  switch (r.kind) {
    case "latency":
      if (r.useCase !== void 0 && r.scenario !== void 0) return scenarioLatency(run, r.useCase, r.scenario, r.percentile, r.maxMs);
      return overUseCases(run, r.useCase, (u) => latency(run, u, r.percentile, r.maxMs), `(limit ${formatMs(r.maxMs)})`);
    case "availability":
      return overUseCases(run, r.useCase, (u) => availability(run, u, r.minPercent), `(limit ${r.minPercent}%)`, true);
    case "durable":
      return durable(run, r.useCase);
    case "survive":
      return survive(run, r.target);
    case "cost":
      return r.scope ? budget(run, r.scope, r.maxUsdPerMonth) : cost(run, r.maxUsdPerMonth);
    case "lag":
      return lag(run, r.useCase, r.maxMs);
  }
}
function overUseCases(run, name, check, limit, anyWithoutTraffic = false) {
  if (name !== void 0) {
    const u = findUseCase(run.diagram, name);
    return u ? check(u) : unknownUseCase(run, name);
  }
  let targets = run.diagram.useCases.filter((u) => (run.useCases.get(u.id)?.rps ?? 0) > 0);
  if (targets.length === 0 && anyWithoutTraffic) targets = run.diagram.useCases;
  if (targets.length === 0) return fail("No use case has traffic, so there is nothing to measure", 'Add traffic { "<use case>" 1k rps } for the use cases this applies to');
  const checks = targets.map(check);
  const failed = checks.filter((c) => !c.passed);
  if (failed.length === 0) {
    return pass(checks.length === 1 ? checks[0].message : `All ${checks.length} use cases hold; ${checks.map((c) => c.value).join(", ")} ${limit}`);
  }
  return fail(failed.length === 1 ? failed[0].message : `${failed.map((c) => c.value ?? c.message).join("; ")} ${limit}`, failed[0].hint, failed[0].fix);
}
function unknownUseCase(run, name) {
  const lower = name.toLowerCase();
  const near = run.diagram.useCases.filter((u) => editDistance(u.name.toLowerCase(), lower) <= Math.max(1, Math.floor(name.length / 4)));
  const hint = near.length ? `Use one of ${near.map((u) => quote(u.name)).join(", ")}` : `Add usecase ${quote(name)} { \u2026 }`;
  return { ...fail(`No use case named ${quote(name)}`, hint), missing: `use case ${name}` };
}
function saturatedOn(run, ids, value, maxMs) {
  const n = [...new Set(ids)].map((id) => run.nodes.get(id)).find((x) => !!x?.saturated);
  if (!n) return void 0;
  const v = value(n);
  const { hint, fix } = saturationLever(run, n);
  return { ...fail(`${v} (limit ${formatMs(maxMs)})`, hint, fix), value: v };
}
function latency(run, u, q, maxMs) {
  const result = run.useCases.get(u.id);
  const key = percentileName(q);
  const shares = run.shares.get(u.id) ?? [];
  const touched = u.scenarios.flatMap((s, i) => (shares[i] ?? 0) > 0 ? s.steps.map((step) => step.toServiceId) : []);
  const saturated = saturatedOn(run, touched, (n) => `${key} of ${u.name}: ${n.id} is saturated (${usageText(n)})`, maxMs);
  if (saturated) return saturated;
  const ms = result.percentiles[key];
  const value = `${key} of ${u.name} is ${formatMs(ms)}${result.rps > 0 ? "" : " with no traffic"}`;
  const message = `${value} (limit ${formatMs(maxMs)})`;
  if (ms < maxMs) return { ...pass(message), value };
  const index = Math.min(result.tailScenario[key] ?? 0, u.scenarios.length - 1);
  const lead = u.scenarios.length > 1 ? `The "${u.scenarios[index].name}" path (${formatPercent(result.scenarios[index].share)} of traffic) sets ${key}. ` : "";
  return { ...fail(message, lead + latencyHint(run, u, u.scenarios[index])), value };
}
function scenarioLatency(run, useCase, scenario, q, maxMs) {
  const sc = scope(run, useCase, scenario);
  if (isCheck(sc)) return sc;
  const s = sc.scenarios[0];
  const key = percentileName(q);
  const what = `${key} of "${sc.u.name}" scenario "${s.name}"`;
  const saturated = saturatedOn(run, s.steps.map((step) => step.toServiceId), (n) => `${what}: ${n.id} is saturated (${usageText(n)})`, maxMs);
  if (saturated) return saturated;
  const result = run.useCases.get(sc.u.id)?.scenarios[sc.u.scenarios.indexOf(s)];
  const ms = result?.percentiles[key] ?? 0;
  const message = `${what} is ${formatMs(ms)} (limit ${formatMs(maxMs)})`;
  return ms < maxMs ? pass(message) : fail(message, latencyHint(run, sc.u, s));
}
function saturationLever(run, n) {
  const label = nodeLabel(run.diagram, n.id);
  if (bandwidthBound(n)) {
    const replicas2 = Math.ceil(n.bandwidthUtilization * n.replicas / HOT);
    const hint = `${label} moves more payload bytes than its network carries. Send the bytes around it (clients upload to and download from object storage or a CDN directly, with presigned URLs), or add replicas: x${replicas2} keeps its bandwidth under ${formatPercent(HOT)}`;
    return { hint, fix: { kind: "replicas", node: n.id, replicas: replicas2 } };
  }
  if (writeBound(n)) {
    const perShard = n.writeCapacityRps / n.shards;
    const shards = Math.ceil(n.writeLoadRps / (perShard * HOT));
    const hint = `Writes to ${label} need ${formatRps(n.writeLoadRps)} and each primary takes ${formatRps(perShard)}; read replicas do not add write capacity. Add shards (capacity { ${n.id} shards ${shards} } keeps writes under ${formatPercent(HOT)}), move the data to a partitioned store (DynamoDB, Cassandra), or batch writes through a queue`;
    return { hint, fix: { kind: "shards", node: n.id, shards } };
  }
  const rho = n.writeScaling === "shards" ? n.readUtilization : n.utilization;
  const replicas = Math.ceil(rho * n.replicas / HOT);
  return {
    hint: `Add replicas to ${label}: x${replicas} keeps it under ${formatPercent(HOT)}, or take load off it (a cache in front, or async work)`,
    fix: { kind: "replicas", node: n.id, replicas }
  };
}
function latencyHint(run, u, scenario) {
  const hops = criticalPath(u, scenario).flat();
  const timeout = (id) => run.profiles.get(id)?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cost2 = (h2) => h2.failed ? timeout(h2.target) : run.nodes.get(h2.target)?.latencyMs ?? 0;
  const slowest = hops.reduce((best, h2) => !best || cost2(h2) > cost2(best) ? h2 : best, void 0);
  if (!slowest) return "Shorten the synchronous path of the request.";
  const label = nodeLabel(run.diagram, slowest.target);
  if (slowest.failed) return `It waits ${formatMs(timeout(slowest.target))} for the failed call to ${label}; give that path a smaller share of traffic, avoid the call, or time out sooner (capacity { ${slowest.target} timeout 200ms }).`;
  const sized = hops.find((h2) => (h2.step.sizeBytes ?? 0) > 0);
  const node = run.nodes.get(slowest.target);
  if (node && node.utilization > HOT) return `${label} runs at ${formatPercent(node.utilization)} and queues requests; add replicas to it.`;
  const payload = sized ? ` Payloads add transfer time too (${stepText(sized.step)}): send fewer bytes or let the client fetch them from a CDN or storage directly.` : "";
  return `Its slowest hop is ${label} at ${formatMs(cost2(slowest))}: put a cache in front of it, run independent calls in par, or move work off the request path with ->>.${payload}`;
}
function availability(run, u, minPercent) {
  const result = run.useCases.get(u.id);
  const value = `availability of ${u.name} is ${formatAvailability(result.availability)}`;
  const message = `${value} (limit ${minPercent}%)`;
  if (result.availability * 100 >= minPercent - 1e-9) return { ...pass(message), value };
  const shares = run.shares.get(u.id) ?? [];
  const main = u.scenarios.length ? pathNodes(u, u.scenarios[mainScenarioIndex(shares)]) : [];
  const writes = mainWrites(u, shares, run.isWrite);
  const effective = (n) => writes.has(n.id) ? n.writeAvailability : n.availability;
  const weakest = main.filter((id) => fallbacksFor(u, id).length === 0).map((id) => run.nodes.get(id)).filter((n) => !!n && effective(n) < 1).sort((a, b) => effective(a) - effective(b))[0];
  const primaryBound = weakest && writes.has(weakest.id) && weakest.writeAvailability < weakest.availability;
  const hint = !weakest ? "Add replicas to the nodes on the main path, or fallback scenarios that complete without them" : primaryBound ? `The weakest link is writing to ${nodeLabel(run.diagram, weakest.id)}: writes need its primary, ${formatAvailability(weakest.writeAvailability)} with failover${weakest.replicas < 2 ? " (none without a second replica; add one)" : ` (a replica takes over, but about ${formatPercent(FAILOVER_SHARE)} of each outage is lost)`}. Move the writes to a partitioned store, or add a fallback scenario that calls it with -x and still completes` : weakest.failed ? `${nodeLabel(run.diagram, weakest.id)} is down in this what-if: add a fallback scenario in "${u.name}" that calls ${weakest.id} with -x and still completes` : `The weakest link is ${nodeLabel(run.diagram, weakest.id)} at ${formatAvailability(effective(weakest))}: add a replica (x${weakest.replicas + 1}) or a fallback scenario that calls it with -x and still completes`;
  return { ...fail(message, hint), value };
}
function writeGap(run, u, s, accept, isWrite = run.isWrite) {
  const { requests, beforeResponse } = requestOrder(u, s);
  const hits = requests.map((m, i) => ({ m, i })).filter(({ m }) => !m.failed && accept(m.to));
  const writes = hits.filter(({ m }) => isWrite(m.step));
  const early = writes.find(({ m, i }) => m.async && i < beforeResponse);
  if (early) return { kind: "async", step: early.m.step };
  const late = writes.find(({ i }) => i >= beforeResponse);
  if (late) return { kind: "after", step: late.m.step };
  const read2 = hits.find(({ m, i }) => i < beforeResponse && !m.async);
  if (read2) return { kind: "read", step: read2.m.step };
  return { kind: "none" };
}
function writesCheck(run, u, scenarios, accept, what) {
  const success = scenarios.filter((s) => s.outcome === "success");
  if (success.length === 0) return fail(`"${u.name}" has no success scenario to check`, "Add a scenario whose entry request is answered with a 2xx");
  const gaps = success.filter((s) => !writesBeforeResponse(u, s, accept, run.isWrite));
  if (gaps.length === 0) {
    const label = success.length === 1 ? `"${u.name}"` : `Every success scenario of "${u.name}"`;
    return pass(`${label} writes to ${what} before responding`);
  }
  const details = gaps.map((s) => ({ s, gap: writeGap(run, u, s, accept) }));
  const where2 = (s) => u.scenarios.length > 1 ? `"${s.name}"` : `"${u.name}"`;
  const text = (s, gap) => {
    switch (gap.kind) {
      case "async":
        return `${where2(s)} writes to ${what} only asynchronously: ${stepText(gap.step)}`;
      case "after":
        return `${where2(s)} writes to ${what} only after responding: ${stepText(gap.step)}`;
      case "read":
        return `${where2(s)} only reads from ${what} before responding: ${stepText(gap.step)} is a read`;
      case "none":
        return `${where2(s)} never writes to ${what} before responding`;
    }
  };
  const message = details.map(({ s, gap }) => text(s, gap)).join("; ");
  const hints = {
    async: "Make the write a synchronous request (->) so it is acknowledged before the response",
    after: "Move the write before the step that answers the entry request",
    read: "Only writes count: start the label with a write verb (INSERT, UPDATE, PUT, SET, \u2026) or use POST, PUT, PATCH or DELETE if the step stores data",
    none: `Add a synchronous write (->) to ${what} before the entry request is answered`
  };
  return fail(message, hints[details[0].gap.kind]);
}
function durable(run, name) {
  const u = findUseCase(run.diagram, name);
  if (!u) return unknownUseCase(run, name);
  return writesCheck(run, u, u.scenarios, (id) => !!run.nodes.get(id)?.durable, "a durable store");
}
function survive(run, target) {
  const all = components(run.diagram);
  const selected = target === "any" ? all.filter((n) => DEPLOYED(run.nodes.get(n.id).kind)) : selectNodes(run.diagram, target);
  const what = target === "any" ? "any one node" : selectorText(target);
  if (selected.length === 0) {
    return target === "any" ? pass("No nodes to lose") : fail(`No node matches ${what}`, "Use a node id, [Tech] or any <kind>");
  }
  const latencies = (run.diagram.requirements ?? []).filter((r) => r.kind === "latency" && requirement(run, r).passed);
  const failures = [];
  for (const node of selected) {
    const n = run.nodes.get(node.id);
    const label = nodeLabel(run.diagram, node.id);
    const replicas = replicasOf(node);
    if (replicas >= 2) {
      const degradedOptions = { ...run.options, replicas: new Map([...run.options.replicas ?? [], [node.id, replicas - 1]]) };
      const degraded = makeRun(run.diagram, analyze(run.diagram, degradedOptions), degradedOptions);
      const left = degraded.nodes.get(node.id);
      const lost = n.shards > 1 ? `one of the ${replicas} replicas of a ${node.id} shard` : `one of ${replicas} ${node.id} replicas`;
      if (left.saturated) {
        const leaves = bandwidthBound(left) ? `leaves ${usageText(left)}` : n.shards > 1 ? `leaves that shard ${formatRps(left.capacityRps / n.shards)} for ${formatRps(n.loadRps / n.shards)}` : `leaves ${formatRps(left.capacityRps)} for ${formatRps(n.loadRps)}`;
        const lever = writeBound(left) ? saturationLever(run, { ...n, ...left }) : { hint: `Add a replica to ${label} (x${replicas + 1}) so the rest carry the load`, fix: { kind: "replicas", node: node.id, replicas: replicas + 1 } };
        failures.push(fail(`Losing ${lost} ${leaves}${bandwidthBound(left) ? "" : ` (${formatPercent(left.utilization)})`}`, lever.hint, lever.fix));
        continue;
      }
      const broken = latencies.map((r) => requirement(degraded, r)).find((c) => !c.passed);
      if (broken) {
        failures.push(
          fail(
            `Losing ${lost} breaks a latency limit: ${broken.message}`,
            `Add a replica to ${label} (x${replicas + 1}) so the rest keep it under ${formatPercent(HOT)}, or take load off it`,
            { kind: "replicas", node: node.id, replicas: replicas + 1 }
          )
        );
      }
      continue;
    }
    for (const u of run.diagram.useCases) {
      if (needs(u, node.id) && fallbacksFor(u, node.id).length === 0) {
        failures.push(
          fail(
            `Losing ${label} breaks "${u.name}"`,
            `Add a replica (x2 on ${node.id}) or a fallback scenario in "${u.name}" that calls ${node.id} with -x and still completes`,
            { kind: "replicas", node: node.id, replicas: 2 }
          )
        );
      }
    }
  }
  if (failures.length === 0) {
    const count = selected.length === 1 ? selected[0].id : `any of ${selected.length} nodes`;
    return pass(`Every use case keeps working after losing ${count}`);
  }
  const more = failures.length > 1 ? ` (and ${failures.length - 1} more)` : "";
  return fail(`${failures[0].message}${more}`, failures[0].hint, failures[0].fix);
}
function cost(run, max) {
  const { totalCostUsd: total, totalEgressUsd: egress } = run.analysis;
  const ofWhich = egress > 0 ? `, ${formatUsd(egress)} of it egress` : "";
  const message = `Total cost is ${formatUsd(total)}${ofWhich} (limit ${formatUsd(max)})`;
  if (total <= max) return pass(message);
  const usd = (x) => formatUsd(x).replace("/month", "");
  const top = [...run.analysis.nodes].filter((n) => n.costUsd > 0).sort((a, b) => b.costUsd - a.costUsd).slice(0, 3).map((n) => {
    const notes = [n.replicas > 1 ? `${n.replicas} replicas` : "", n.shards > 1 ? `${n.shards} shards` : "", n.egressUsd > 0 ? `${usd(n.egressUsd)} of it egress` : ""].filter(Boolean);
    return `${n.id} ${formatUsd(n.costUsd)}${notes.length ? ` (${notes.join(", ")})` : ""}`;
  });
  const egressHint = egress > total / 2 ? " Most of it is egress: serve repeated downloads from a CDN ($0.02/GB) instead of storage ($0.09/GB), or send fewer bytes." : "";
  return fail(message, `Biggest items: ${top.join(", ")}. Drop replicas on nodes with low utilisation or pick cheaper techs.${egressHint}`);
}
function lag(run, name, maxMs) {
  const u = findUseCase(run.diagram, name);
  if (!u) return unknownUseCase(run, name);
  const ids = [...new Set(u.scenarios.flatMap((s) => s.steps.filter((step) => !step.failed).map((step) => step.toServiceId)))];
  const queues = ids.map((id) => run.nodes.get(id)).filter((n) => !!n?.queue);
  if (queues.length === 0) {
    const plain = ids.find((id) => ["queue", "broker"].includes(run.nodes.get(id)?.kind ?? ""));
    return fail(
      `"${u.name}" sends to no queue with a drain rate, so it has no lag to measure`,
      plain ? `Say how fast its consumers take messages: capacity { ${plain} drain 1k rps }` : "Send its slow work to a queue (->> queue) and give the queue a drain rate in capacity"
    );
  }
  const slowest = queues.reduce((worst, n) => n.queue.lagMs > worst.queue.lagMs ? n : worst);
  const q = slowest.queue;
  if (q.backlogPerHour > 0) {
    return fail(
      `"${u.name}" falls behind at ${slowest.id}: ${formatRps(q.inflowRps)} flows in, its consumers drain ${formatRps(q.drainRps)}, and the backlog grows by ${formatCount(q.backlogPerHour)} messages an hour (limit ${formatDuration(maxMs)})`,
      `Drain ${slowest.id} faster than ${formatRps(q.inflowRps)}: more consumers, or capacity { ${slowest.id} drain ${formatRps(Math.ceil(q.inflowRps / 0.7 / 100) * 100)} }`
    );
  }
  const message = `Lag of "${u.name}" is ${formatDuration(q.lagMs)} at ${slowest.id}, its consumers ${formatPercent(q.utilization)} busy (limit ${formatDuration(maxMs)})`;
  return q.lagMs < maxMs ? pass(message) : fail(message, `Drain ${slowest.id} faster, so its consumers run below ${formatPercent(HOT)}`);
}
var scopeText = (scope2) => "team" in scope2 ? `@${scope2.team}` : "tag" in scope2 ? `.${scope2.tag}` : `group ${scope2.group}`;
function budget(run, scope2, max) {
  const share2 = scopedCost(run.diagram, run.analysis, scope2);
  const what = scopeText(scope2);
  if (share2.nodes.length === 0) return fail(`No node is covered by ${what}`, "team" in scope2 ? `Give nodes the team with ${what} after their name` : "tag" in scope2 ? `Tag nodes or groups with ${what}` : `Add nodes inside ${what}`);
  const ofWhich = share2.egressUsd > 0 ? `, ${formatUsd(share2.egressUsd)} of it egress` : "";
  const message = `${what} costs ${formatUsd(share2.costUsd)}${ofWhich} (limit ${formatUsd(max)})`;
  if (share2.costUsd <= max) return pass(message);
  const nodes = new Map(run.analysis.nodes.map((n) => [n.id, n]));
  const top = share2.nodes.slice(0, 3).map((id) => `${id} ${formatUsd(nodes.get(id).costUsd)}`);
  return fail(message, `Biggest items: ${top.join(", ")}. Drop replicas on nodes with low utilisation, pick cheaper techs, or move work to another team's budget.`);
}
function flowTest(run, test) {
  const checks = test.assertions.map((a) => ({ ...assertion(run, a), loc: a.loc }));
  const assertions = checks.map(({ passed, message, hint, loc }) => hint === void 0 ? { passed, message, loc } : { passed, message, hint, loc });
  if (assertions.length === 0) return { passed: true, message: "No assertions to check", assertions };
  const failed = checks.filter((a) => !a.passed);
  if (failed.length === 0) {
    return { passed: true, message: assertions.length === 1 ? assertions[0].message : `All ${assertions.length} assertions hold`, assertions };
  }
  const seen = /* @__PURE__ */ new Set();
  const reported = failed.filter((a) => {
    const key = a.missing ?? a.message;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { passed: false, message: reported.map((a) => a.message).join("; "), hint: reported[0].hint, assertions };
}
var quote = (s) => `"${s}"`;
function scope(run, useCase, scenario) {
  const u = findUseCase(run.diagram, useCase);
  if (!u) return unknownUseCase(run, useCase);
  if (scenario === void 0) return { u, scenarios: u.scenarios, label: quote(u.name) };
  const s = findScenario(u, scenario);
  if (!s) return missingScenario(u, scenario);
  return { u, scenarios: [s], label: `${quote(u.name)} scenario ${quote(s.name)}` };
}
function missingScenario(u, scenario) {
  const names = u.scenarios.map((s) => quote(s.name)).join(", ");
  return {
    ...fail(`${quote(u.name)} has no scenario ${quote(scenario)}${names ? `; it has ${names}` : ""}`, `Add alt "${scenario}" { \u2026 } to "${u.name}"`),
    missing: `scenario ${u.name} \u203A ${scenario}`
  };
}
var isCheck = (x) => "passed" in x;
var idsOf = (run, selector) => new Set(selectNodes(run.diagram, selector).map((n) => n.id));
function assertion(run, a) {
  switch (a.kind) {
    case "calls":
      return calls(run, a);
    case "before":
      return before(run, a);
    case "writesBeforeResponding": {
      const sc = scope(run, a.useCase, a.scenario);
      if (isCheck(sc)) return sc;
      const ids = idsOf(run, a.target);
      if (ids.size === 0) return noMatch(a.target);
      return writesCheck(run, sc.u, sc.scenarios, (id) => ids.has(id), selectorText(a.target));
    }
    case "beforeResponding":
      return beforeResponding(run, a);
    case "responds":
      return responds(run, a);
    case "hasScenario": {
      const u = findUseCase(run.diagram, a.useCase);
      if (!u) return unknownUseCase(run, a.useCase);
      const s = findScenario(u, a.scenario);
      return s ? pass(`${quote(u.name)} has scenario ${quote(s.name)}`) : missingScenario(u, a.scenario);
    }
    case "handlesFailure": {
      const u = findUseCase(run.diagram, a.useCase);
      if (!u) return unknownUseCase(run, a.useCase);
      const ids = idsOf(run, a.target);
      if (ids.size === 0) return noMatch(a.target);
      const handled = u.scenarios.find((s) => s.outcome === "success" && s.steps.some((step) => step.failed && ids.has(step.toServiceId)));
      const what = selectorText(a.target);
      return handled ? pass(`${quote(u.name)} handles a failed call to ${what} in ${quote(handled.name)}`) : fail(
        `No success scenario of ${quote(u.name)} has a failed call to ${what}`,
        `Add alt "${what} down" { \u2026 -x ${[...ids][0]} \u2026 } that still answers the entry request with a 2xx`
      );
    }
    case "noPath":
      return noPath(run, a.from, a.to);
    case "replicas": {
      const nodes = selectNodes(run.diagram, a.target);
      if (nodes.length === 0) return noMatch(a.target);
      const short = nodes.filter((n) => replicasOf(n) < a.min);
      const has = (n) => `${n.id} has ${replicasOf(n)} replica${replicasOf(n) === 1 ? "" : "s"}`;
      if (short.length === 0) return pass(`${nodes.map(has).join(", ")} (minimum ${a.min})`);
      return fail(`${short.map(has).join(", ")} (minimum ${a.min})`, `Declare ${short[0].id} with x${a.min}`);
    }
    case "neverWaits":
      return neverWaits(run, a);
    case "after":
      return after(run, a);
    case "senderCalls":
      return senderCalls(run, a);
    case "startsAt":
      return startsAt(run, a);
  }
}
function noMatch(selector) {
  return fail(`No node matches ${selectorText(selector)}`, "Use a node id, [Tech] or any <kind> (any cache, any database, \u2026)");
}
function callNoun(selector, match) {
  const target = selectorText(selector);
  if (match?.op !== void 0) return `${match.op} on ${target}`;
  if (match?.header !== void 0) return `header ${match.header} to ${target}`;
  if (match?.method !== void 0) return `${match.method} ${match.path ?? ""} to ${target}`;
  return target;
}
var baseForm = (phrase) => phrase.replace(/^(\w+?)s\b/, "$1");
function vocabularyGap(run, ids, selector, match) {
  if (match?.op === void 0 && match?.header === void 0) return void 0;
  const nodes = run.diagram.nodes.filter((n) => ids.has(n.id));
  if (nodes.some((n) => n.kind === "system")) return void 0;
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const what = selectorText(selector);
  const types = nodes.map((n) => n.resolvedType);
  const listed = (names) => `${names.slice(0, 8).join(", ")}${names.length > 8 ? ", \u2026" : ""}`;
  const { op, header } = match;
  if (op !== void 0 && !types.some((t) => t?.ops.some((o) => same(o.name, op)))) {
    const ops = [...new Set(types.flatMap((t) => t?.ops.map((o) => o.name) ?? []))];
    return fail(
      `No node matching ${what} has an operation '${op}'`,
      ops.length ? `Its operations are ${listed(ops)}` : `${what} has no typed operations; give it a type with op lines, or assert calls ${what} instead`
    );
  }
  if (header !== void 0 && types.every((t) => t && t.headers.length > 0 && !t.headers.some((h2) => same(h2, header)))) {
    const headers = [...new Set(types.flatMap((t) => t?.headers ?? []))];
    return fail(`No node matching ${what} takes the header '${header}'`, `Its headers are ${listed(headers)}`);
  }
  return void 0;
}
function matchHint(selector, match) {
  const what = selectorText(selector);
  if (match?.op !== void 0) return `Add a step to ${what} whose label starts with ${match.op}`;
  if (match?.header !== void 0) return `Name the header in a request to ${what}: GET /path header ${match.header}`;
  if (match?.method !== void 0) return `Add a step to ${what} labelled ${match.method} ${match.path ?? ""}`.trimEnd();
  return `Add a step to ${what}`;
}
function otherSteps(scenarios, ids, match) {
  if (!match) return "";
  const steps = scenarios.flatMap((s) => s.steps.filter((step) => ids.has(step.toServiceId)));
  const labels = [...new Set(steps.map((step) => requestLabel(step) || "(no label)"))];
  return labels.length ? `; its steps there are ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ", \u2026" : ""}` : "";
}
function calls(run, a) {
  const sc = scope(run, a.useCase, a.scenario);
  if (isCheck(sc)) return sc;
  const what = selectorText(a.target);
  const phrase = callText(a.target, a.match);
  const ids = idsOf(run, a.target);
  const called = (s) => s.steps.filter((step) => ids.has(step.toServiceId) && stepMatches(step, a.match));
  const calling = sc.scenarios.filter((s) => called(s).length > 0);
  const names = (list) => list.map((s) => quote(s.name)).join(", ");
  const multi = sc.scenarios.length > 1;
  const gap = vocabularyGap(run, ids, a.target, a.match);
  if (gap) return gap;
  if (a.quantifier === "never") {
    if (calling.length === 0) return pass(`${sc.label} never ${phrase}`);
    const first = calling[0];
    const step = called(first)[0];
    return fail(
      `${multi ? quote(first.name) : sc.label} ${a.match ? phrase : `calls ${nodeLabel(run.diagram, step.toServiceId)}`}: ${stepText(step)}`,
      a.match ? `Change or remove the step to ${step.toServiceId} in ${quote(first.name)}` : `Take the call to ${step.toServiceId} out of ${quote(first.name)}, e.g. serve it from a cache`
    );
  }
  if (ids.size === 0) return noMatch(a.target);
  if (a.quantifier === "some") {
    if (calling.length) return pass(`${sc.label} ${phrase}${multi ? ` in ${names(calling)}` : ""}`);
    return fail(`${sc.label} never ${phrase}${otherSteps(sc.scenarios, ids, a.match)}`, matchHint(a.target, a.match));
  }
  const missing = sc.scenarios.filter((s) => !calling.includes(s));
  if (missing.length === 0 && sc.scenarios.length) return pass(`Every scenario of ${sc.label} ${phrase}`);
  return fail(
    `${sc.label} does not ${baseForm(phrase)} in ${names(missing) || "any scenario"}${otherSteps(missing, ids, a.match)}`,
    a.match ? `${matchHint(a.target, a.match)} in ${names(missing) || "a scenario"}` : `Add a step to ${what} in ${names(missing) || "a scenario"}`
  );
}
function before(run, a) {
  const sc = scope(run, a.useCase, a.scenario);
  if (isCheck(sc)) return sc;
  const first = idsOf(run, a.first);
  const then = idsOf(run, a.then);
  const [x, y] = [callNoun(a.first, a.match), selectorText(a.then)];
  if (first.size === 0) return noMatch(a.first);
  if (then.size === 0) return noMatch(a.then);
  const gap = vocabularyGap(run, first, a.first, a.match);
  if (gap) return gap;
  let checked = 0;
  for (const s of sc.scenarios) {
    const order = requestOrder(sc.u, s).requests;
    const iy = order.findIndex((m) => then.has(m.to));
    if (iy < 0) continue;
    checked++;
    const ix = order.findIndex((m) => first.has(m.to) && stepMatches(m.step, a.match));
    if (ix < 0 || ix > iy) {
      const where2 = sc.scenarios.length > 1 || a.scenario ? `In ${quote(s.name)}` : `In ${quote(sc.u.name)}`;
      return fail(
        ix < 0 ? `${where2}, ${order[iy].to} is called (${stepText(order[iy].step)}) but ${x} never is` : `${where2}, ${order[iy].to} is called (${stepText(order[iy].step)}) before ${order[ix].to} (${stepText(order[ix].step)})`,
        `Call ${x} before the first call to ${y}`
      );
    }
  }
  if (checked === 0) return fail(`${sc.label} never calls ${y}`, `Add a step to ${y} after the call to ${x}`);
  return pass(`${sc.label} ${callText(a.first, a.match)} before ${y}${checked > 1 ? ` in all ${checked} scenarios that call ${y}` : ""}`);
}
function beforeResponding(run, a) {
  const sc = scope(run, a.useCase, a.scenario);
  if (isCheck(sc)) return sc;
  const ids = idsOf(run, a.target);
  if (ids.size === 0) return noMatch(a.target);
  const gap = vocabularyGap(run, ids, a.target, a.match);
  if (gap) return gap;
  const phrase = callText(a.target, a.match);
  const success = sc.scenarios.filter((s) => s.outcome === "success");
  if (success.length === 0) return fail(`${sc.label} has no success scenario to check`, "Add a scenario whose entry request is answered with a 2xx");
  const accept = (id) => ids.has(id);
  const isMatch = (step) => stepMatches(step, a.match);
  const gaps = success.filter((s) => !writesBeforeResponse(sc.u, s, accept, isMatch));
  if (gaps.length === 0) return pass(`${success.length === 1 ? sc.label : `Every success scenario of ${sc.label}`} ${phrase} before responding`);
  const where2 = (s) => sc.u.scenarios.length > 1 ? quote(s.name) : quote(sc.u.name);
  const text = (s) => {
    const g = writeGap(run, sc.u, s, accept, isMatch);
    if (g.kind === "async") return `${where2(s)} ${phrase} only asynchronously: ${stepText(g.step)}`;
    if (g.kind === "after") return `${where2(s)} ${phrase} only after responding: ${stepText(g.step)}`;
    return `${where2(s)} never ${phrase} before responding${otherSteps([s], ids, a.match)}`;
  };
  return fail(gaps.map(text).join("; "), `${matchHint(a.target, a.match)}, sent with -> before the line that answers the entry request`);
}
function neverWaits(run, a) {
  const sc = scope(run, a.useCase, a.scenario);
  if (isCheck(sc)) return sc;
  const ids = idsOf(run, a.target);
  const what = selectorText(a.target);
  for (const s of sc.scenarios) {
    const hop = criticalPath(sc.u, s).flat().find((h2) => !h2.async && ids.has(h2.target));
    if (hop) {
      const where2 = sc.scenarios.length > 1 ? quote(s.name) : sc.label;
      return fail(
        `${where2} waits for ${nodeLabel(run.diagram, hop.target)} before responding: ${stepText(hop.step)}${hop.failed ? " times out on the request path" : " is synchronous"}`,
        `Send it with ->> (through a queue if it must not be lost), or move it after the line that answers the entry request`
      );
    }
  }
  const calledAtAll = sc.scenarios.some((s) => s.steps.some((step) => ids.has(step.toServiceId)));
  return pass(`${sc.label} never waits for ${what}${calledAtAll ? "" : ` (it never calls ${what})`}`);
}
function after(run, a) {
  const sc = scope(run, a.useCase, a.scenario);
  if (isCheck(sc)) return sc;
  const targets = idsOf(run, a.target);
  const firsts = idsOf(run, a.after);
  const [y, x] = [callNoun(a.target, a.match), selectorText(a.after)];
  if (targets.size === 0) return noMatch(a.target);
  if (firsts.size === 0) return noMatch(a.after);
  const gap = vocabularyGap(run, targets, a.target, a.match);
  if (gap) return gap;
  const isTarget = (m) => targets.has(m.to) && stepMatches(m.step, a.match);
  let checked = 0;
  for (const s of sc.scenarios) {
    const order = requestOrder(sc.u, s).requests;
    const ix = order.findIndex((m) => firsts.has(m.to));
    const iy = order.map(isTarget).lastIndexOf(true);
    if (ix < 0 || iy < 0) continue;
    checked++;
    if (iy < ix) {
      const where2 = sc.scenarios.length > 1 || a.scenario ? `In ${quote(s.name)}` : `In ${quote(sc.u.name)}`;
      return fail(
        `${where2}, the last call to ${y} (${stepText(order[iy].step)}) comes before the first call to ${x} (${stepText(order[ix].step)})`,
        `Call ${y} after ${x}: move the step to ${order[iy].to} below the call to ${order[ix].to}`
      );
    }
  }
  if (checked === 0) {
    const callsY = sc.scenarios.some((s) => s.steps.some((step) => targets.has(step.toServiceId) && stepMatches(step, a.match)));
    const callsX = sc.scenarios.some((s) => s.steps.some((step) => firsts.has(step.toServiceId)));
    const why = !callsY && !callsX ? `calls neither ${x} nor ${y}` : !callsY ? `never calls ${y}` : !callsX ? `never calls ${x}` : `never calls ${x} and ${y} in the same scenario`;
    return fail(`${sc.label} ${why}`, `Add a step to ${y} after the call to ${x}`);
  }
  return pass(`${sc.label} ${callText(a.target, a.match)} after ${x}${checked > 1 ? ` in all ${checked} scenarios that call both` : ""}`);
}
function senderCalls(run, a) {
  let useCases = run.diagram.useCases;
  if (a.useCase !== void 0) {
    const u = findUseCase(run.diagram, a.useCase);
    if (!u) return unknownUseCase(run, a.useCase);
    useCases = [u];
  }
  const from = idsOf(run, a.from);
  const to = idsOf(run, a.to);
  const [x, y] = [selectorText(a.from), selectorText(a.to)];
  const within = a.useCase !== void 0 ? ` in ${quote(useCases[0].name)}` : "";
  for (const u of useCases) {
    for (const s of u.scenarios) {
      const step = s.steps.find((st) => from.has(st.fromServiceId) && to.has(st.toServiceId));
      if (!step) continue;
      const where2 = u.scenarios.length > 1 ? `${quote(u.name)} scenario ${quote(s.name)}` : quote(u.name);
      if (a.quantifier === "some") return pass(`${x} calls ${y}${within}: ${stepText(step)} in ${where2}`);
      return fail(
        `${x} calls ${y}${within}: ${stepText(step)} in ${where2}`,
        `Let another node make this call (e.g. the client uploads to storage with a presigned URL), or remove the step`
      );
    }
  }
  if (a.quantifier === "never") return pass(`${x} never calls ${y}${within}`);
  if (from.size === 0) return noMatch(a.from);
  if (to.size === 0) return noMatch(a.to);
  return fail(`No step is sent by ${x} to ${y}${within}`, `Add a step ${[...from][0]} -> ${[...to][0]}${within}`);
}
function startsAt(run, a) {
  const u = findUseCase(run.diagram, a.useCase);
  if (!u) return unknownUseCase(run, a.useCase);
  const ids = idsOf(run, a.target);
  const what = selectorText(a.target);
  if (ids.size === 0) return noMatch(a.target);
  const entries2 = u.scenarios.map((s) => s.steps[0]).filter((s) => !!s);
  if (entries2.length === 0) return fail(`${quote(u.name)} has no steps`, `Start "${u.name}" with a step sent by ${what}`);
  const wrong = entries2.find((s) => !ids.has(s.fromServiceId));
  if (wrong) {
    return fail(
      `${quote(u.name)} starts at ${nodeLabel(run.diagram, wrong.fromServiceId)}, not ${what}: ${stepText(wrong)}`,
      `Make the first step of "${u.name}" a step sent by ${what}`
    );
  }
  return pass(`${quote(u.name)} starts at ${nodeLabel(run.diagram, entries2[0].fromServiceId)}`);
}
function statusMatches(status, wanted) {
  if (status === void 0) return false;
  const cls = /^([1-5])xx$/i.exec(wanted);
  return cls ? Math.floor(status / 100) === Number(cls[1]) : String(status) === wanted;
}
function responds(run, a) {
  const sc = scope(run, a.useCase, a.scenario);
  if (isCheck(sc)) return sc;
  const hit = sc.scenarios.find((s) => statusMatches(s.steps[0]?.statusCode, a.status));
  if (hit) return pass(`${sc.label} responds ${hit.steps[0].statusCode}${sc.scenarios.length > 1 ? ` in ${quote(hit.name)}` : ""}`);
  const seen = [...new Set(sc.scenarios.map((s) => s.steps[0]?.failed ? "a failed call" : s.steps[0]?.statusCode ?? "no status"))];
  return fail(`${sc.label} never responds ${a.status}; it answers ${seen.join(", ") || "nothing"}`, `Add a scenario (alt) whose entry request is answered with ${a.status}`);
}
function noPath(run, from, to) {
  const sources = idsOf(run, from);
  const targets = idsOf(run, to);
  const [x, y] = [selectorText(from), selectorText(to)];
  const hint = `Route it through a node that guards ${y} (a gateway or a service) instead of going there directly`;
  const edge = run.diagram.edges.find((e) => sources.has(e.source) && targets.has(e.target));
  if (edge) return fail(`The connection ${edge.source} -> ${edge.target} (${lineOf(edge.loc)}) goes directly from ${x} to ${y}`, hint);
  for (const u of run.diagram.useCases) {
    for (const s of u.scenarios) {
      const step = s.steps.find((st) => sources.has(st.fromServiceId) && targets.has(st.toServiceId));
      if (step) {
        const where2 = u.scenarios.length > 1 ? `${quote(u.name)} scenario ${quote(s.name)}` : quote(u.name);
        return fail(`The step ${step.fromServiceId} -> ${step.toServiceId} in ${where2} (${lineOf(step.loc)}) goes directly from ${x} to ${y}`, hint);
      }
    }
  }
  return pass(`No connection or step goes directly from ${x} to ${y}`);
}

// ../frontend/src/dsl/view.ts
var FRAME_TECH = "Service Group";
function viewDiagram(diagram, options = {}) {
  const expanded = options.expanded ?? /* @__PURE__ */ new Set();
  if (options.focus !== void 0) {
    const team = systemAt(diagram, options.focus);
    if (team?.diagram) {
      const prefix = `${options.focus}.`;
      const inner = new Set([...expanded].filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length)));
      return viewDiagram(team.diagram, { expanded: inner });
    }
  }
  const open = (diagram.systems ?? []).filter((s) => s.diagram && expanded.has(s.id));
  if (open.length === 0) return diagram;
  const nodes = [];
  const edges = [];
  const useCases = [];
  const route = entryRouter(diagram, expanded, "");
  const openIds = new Set(open.map((s) => s.id));
  for (const node of diagram.nodes) {
    if (!openIds.has(node.id)) {
      nodes.push(node);
      continue;
    }
    nodes.push(frameOf(node, node.id));
    const system = open.find((s) => s.id === node.id);
    inline(system.diagram, `${node.id}.`, node, expanded, nodes, edges, useCases);
  }
  for (const edge of diagram.edges) edges.push(rerouteEdge(edge, route));
  return { ...diagram, nodes, edges, useCases: [...diagram.useCases.map((u) => rerouteUseCase(u, route)), ...useCases] };
}
function systemAt(diagram, path) {
  const [head, ...rest] = path.split(".");
  const system = diagram.systems?.find((s) => s.id === head);
  if (!system || rest.length === 0) return system;
  return system.diagram ? systemAt(system.diagram, rest.join(".")) : void 0;
}
var frameOf = (node, id) => ({ ...node, id, kind: "group", type: "group", techStack: FRAME_TECH, system: id });
function inline(team, prefix, owner, expanded, nodes, edges, useCases) {
  const ownerId = prefix.slice(0, -1);
  const route = entryRouter(team, expanded, prefix);
  for (const node of team.nodes) {
    const id = prefix + node.id;
    const parent = node.parent !== void 0 ? prefix + node.parent : ownerId;
    const system = team.systems?.find((s) => s.id === node.id);
    if (system?.diagram && expanded.has(id)) {
      nodes.push({ ...frameOf(node, id), parent });
      inline(system.diagram, `${id}.`, node, expanded, nodes, edges, useCases);
    } else {
      const { position: _position, ...rest } = node;
      void _position;
      nodes.push({ ...rest, id, parent, system: ownerId });
    }
  }
  for (const edge of team.edges) edges.push(rerouteEdge({ ...edge, id: prefix + edge.id, source: prefix + edge.source, target: prefix + edge.target }, route));
  for (const u of team.useCases) {
    const named = { ...u, id: prefix + u.id, name: `${owner.name}: ${u.name}`, entryServiceId: u.entryServiceId !== void 0 ? prefix + u.entryServiceId : void 0 };
    useCases.push(rerouteUseCase(prefixUseCase(named, prefix), route));
  }
}
function prefixUseCase(u, prefix) {
  const step = (s) => ({ ...s, ...s.id !== void 0 ? { id: prefix + s.id } : {}, fromServiceId: prefix + s.fromServiceId, toServiceId: prefix + s.toServiceId });
  const scenarios = u.scenarios.map((sc) => ({ ...sc, steps: sc.steps.map(step) }));
  return { ...u, steps: scenarios[0]?.steps ?? [], scenarios };
}
function entryRouter(diagram, expanded, prefix) {
  const route = (id, port) => {
    if (port === void 0 || !expanded.has(id)) return { id, port };
    const local = id.slice(prefix.length);
    const system = diagram.systems?.find((s) => s.id === local);
    const entry = system?.entries.find((e) => e.id === port);
    const team = system?.diagram;
    const first = team?.useCases.find((u) => u.id === entry?.useCaseId)?.steps[0];
    if (!team || !first) return { id };
    const sender = team.nodes.find((n) => n.id === first.fromServiceId);
    if (sender && kindOf(sender) !== "client") return { id: `${id}.${sender.id}` };
    return entryRouter(team, expanded, `${id}.`)(`${id}.${first.toServiceId}`, first.toPort);
  };
  return route;
}
function rerouteEdge(edge, route) {
  const { id: target, port } = route(edge.target, edge.targetPort);
  if (target === edge.target && port === edge.targetPort) return edge;
  const { targetPort: _targetPort, ...rest } = edge;
  void _targetPort;
  return { ...rest, target, ...port !== void 0 ? { targetPort: port } : {} };
}
function rerouteUseCase(u, route) {
  let changed = false;
  const step = (s) => {
    const { id, port } = route(s.toServiceId, s.toPort);
    if (id === s.toServiceId && port === s.toPort) return s;
    changed = true;
    const { toPort: _toPort, ...rest } = s;
    void _toPort;
    return { ...rest, toServiceId: id, ...port !== void 0 ? { toPort: port } : {} };
  };
  const scenarios = u.scenarios.map((sc) => ({ ...sc, steps: sc.steps.map(step) }));
  return changed ? { ...u, steps: scenarios[0]?.steps ?? [], scenarios } : u;
}

// src/terminal/systems.ts
function systemAt2(diagram, path) {
  const [head, ...rest] = path.split(".");
  const system = diagram.systems?.find((s) => s.id === head);
  if (!system || rest.length === 0) return system;
  return system.diagram ? systemAt2(system.diagram, rest.join(".")) : void 0;
}
function systemPaths(diagram, prefix = "") {
  return (diagram.systems ?? []).flatMap((s) => [prefix + s.id, ...s.diagram ? systemPaths(s.diagram, `${prefix}${s.id}.`) : []]);
}
function viewError(diagram, view) {
  const known = systemPaths(diagram);
  const check = (id, what) => {
    const system = systemAt2(diagram, id);
    if (!system) return `No system '${id}' to ${what}; ${known.length ? `the systems are ${known.join(", ")}` : "the diagram has no systems"}.`;
    if (!system.diagram) return `System '${id}' has no team design (from "\u2026") to ${what}.`;
    return void 0;
  };
  for (const id of view.expanded ?? []) {
    const error = check(id, "expand");
    if (error) return error;
  }
  return view.focus !== void 0 ? check(view.focus, "focus") : void 0;
}
function viewOptions(view = {}) {
  const expanded = /* @__PURE__ */ new Set();
  for (const id of view.expanded ?? []) {
    const parts = id.split(".");
    for (let i = 1; i <= parts.length; i++) expanded.add(parts.slice(0, i).join("."));
  }
  return { expanded, ...view.focus !== void 0 ? { focus: view.focus } : {} };
}
function applyView(diagram, view = {}) {
  return view.focus === void 0 && !view.expanded?.length ? diagram : viewDiagram(diagram, viewOptions(view));
}
var idList = (value) => value.split(",").map((s) => s.trim()).filter(Boolean);
function viewOverlay(diagram, analysis, view = {}) {
  const out = { nodes: {}, systems: {}, notes: [] };
  const { expanded } = viewOptions(view);
  let scope2 = diagram;
  let scoped = analysis;
  let load = analysis ? analysisOverlay(diagram, analysis) : void 0;
  let path = "";
  if (view.focus !== void 0 && systemAt2(diagram, view.focus)?.diagram) {
    for (const id of view.focus.split(".")) {
      const system = scope2.systems.find((s) => s.id === id);
      const result = scoped?.systems?.find((s) => s.id === id);
      if (path + id === view.focus) notesOf(scope2, scoped, system, result, path, out);
      scoped = teamAnalysis(system, result);
      load = teamLoad(system, result, scoped);
      scope2 = system.diagram;
      path += `${id}.`;
    }
  }
  collect(scope2, scoped, load, "", path, expanded, out);
  return out;
}
function teamAnalysis(system, result) {
  return result?.analysis ?? (system.diagram ? contractOf(system).baseline : void 0);
}
function teamLoad(system, result, analysis) {
  return result?.overlay ?? (analysis && system.diagram ? analysisOverlay(system.diagram, analysis) : void 0);
}
function collect(diagram, analysis, load, at, path, expanded, out) {
  for (const [id, o] of Object.entries(load?.nodes ?? {})) out.nodes[at + id] = o;
  for (const system of diagram.systems ?? []) {
    const result = analysis?.systems?.find((s) => s.id === system.id);
    out.systems[at + system.id] = badgeOf(diagram, system, result);
    notesOf(diagram, analysis, system, result, path, out);
    if (system.diagram && expanded.has(path + system.id)) {
      const team = teamAnalysis(system, result);
      collect(system.diagram, team, teamLoad(system, result, team), `${at}${system.id}.`, `${path}${system.id}.`, expanded, out);
    }
  }
}
function notesOf(diagram, analysis, system, result, path, out) {
  const warnings = result?.warnings ?? [];
  if (!analysis || warnings.length === 0) return;
  const hint = runTests(diagram, analysis).find((t) => t.id === `system:${system.id}` && !t.passed)?.hint;
  warnings.forEach((text, i) => out.notes.push({ system: path + system.id, text, ...hint && i === warnings.length - 1 ? { hint } : {} }));
}
function badgeOf(diagram, system, result) {
  const contract = result?.contract ?? contractOf(system);
  const latency2 = contract.entries.flatMap((e) => e.latency)[0];
  const availability2 = contract.entries.map((e) => e.availabilityPercent).filter((a) => a !== void 0);
  const promise = [latency2 ? `p${latency2.percentile} ${formatMs(latency2.maxMs)}` : "", availability2.length ? `${Math.min(...availability2)}%` : ""].filter(Boolean).join(" \xB7 ");
  const team = diagram.nodes.find((n) => n.id === system.id)?.ownerTeam;
  const status = contract.source === "none" ? "idle" : result?.saturated ? "saturated" : result?.breaches.length ? "breach" : result?.hot ? "hot" : "ok";
  return {
    ...team ? { team } : {},
    ...promise ? { promise } : {},
    sentRps: result?.totalInboundRps ?? 0,
    headroomRps: Math.min(Infinity, ...contract.entries.map((e) => e.saturatesAtRps)),
    ...result && contract.source !== "none" ? { utilization: result.utilization } : {},
    status
  };
}
function loadText(badge) {
  const head = formatRps(badge.headroomRps);
  return `${formatRps(badge.sentRps).replace(/ rps$/, "")} / ${head}`;
}

// src/terminal/document.ts
var EDITOR = "https://proschi.app/app/";
function parseSource({ source, path = "diagram.proschi", imports = {} }) {
  const result = parse(source, { path, resolve: mapResolver(imports) });
  return { diagram: result.diagram, errors: result.diagnostics.filter((d) => d.severity === "error") };
}
function loadDocument(input) {
  const { diagram, errors } = parseSource(input);
  const simulated = errors.length === 0 && (diagram.traffic?.length ?? 0) > 0;
  const analysis = simulated ? analyze(diagram) : void 0;
  const imports = input.imports && Object.keys(input.imports).length ? input.imports : void 0;
  const view = errors.length ? {} : input.view ?? {};
  const sim = errors.length ? void 0 : viewOverlay(diagram, analysis, view);
  const top = view.focus === void 0;
  if (sim && analysis && top) {
    for (const c of diagram.capacity ?? []) if (c.size && sim.nodes[c.node]) sim.nodes[c.node].size = c.size;
  }
  const overlay = sim && Object.keys(sim.nodes).length ? sim.nodes : void 0;
  return {
    diagram: errors.length ? diagram : applyView(diagram, view),
    root: diagram,
    errors,
    ...overlay ? { overlay } : {},
    systems: sim?.systems ?? {},
    notes: sim?.notes ?? [],
    tests: analysis ? runTests(diagram, analysis) : [],
    link: (playback) => EDITOR + encodeShareHash(input.source, playback, imports)
  };
}
function missingImports(input) {
  const missing = /* @__PURE__ */ new Set();
  const imports = input.imports ?? {};
  const known = mapResolver(imports);
  parse(input.source, {
    path: input.path ?? "diagram.proschi",
    resolve: (importPath, fromPath) => {
      const found = known(importPath, fromPath);
      const key = joinImportPath(fromPath, importPath);
      if (!found && key !== void 0) missing.add(key);
      return found;
    }
  });
  return [...missing];
}
function importFilePath(dir, root, key) {
  if (isRemoteSpec(key) || key.startsWith("/")) return void 0;
  const parts = dir.split("/").filter(Boolean);
  for (const part of key.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const path = `/${parts.join("/")}`;
  return path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`) ? path : void 0;
}
function keyOf(input) {
  const text = input.source + "\0" + JSON.stringify(input.imports ?? {}) + (input.view ? "\0" + JSON.stringify(input.view) : "");
  let h2 = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h2 ^= text.charCodeAt(i);
    h2 = Math.imul(h2, 16777619);
  }
  return (h2 >>> 0).toString(36) + text.length.toString(36);
}

// src/lockFormat.ts
var LOCK_FILE = "proschi.lock";
var CACHE_DIR = ".proschi/cache";
var HASH = /^[0-9a-f]{64}$/;
var COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
var emptyLock = () => ({ version: 1, git: {}, https: {}, cloud: {} });
var gitKey = (repo, ref) => `${repo}@${ref}`;
var cloudKey = (name, tag) => `${name}:${tag}`;
var remoteError = {
  noLock: (spec) => new ImportError(`'${spec}' is a remote import and there is no ${LOCK_FILE}; run proschi imports sync`),
  notLocked: (spec) => spec.startsWith("cloud:") ? remoteError.cloud(spec) : new ImportError(`'${spec}' is not in ${LOCK_FILE}; run proschi imports sync`),
  /** A cloud version that is not pinned yet (docs/design/versions-and-cloud.md). */
  cloud: (spec) => new ImportError(`'${spec}' is a version in your Proschi account; run proschi imports sync to pin it (cloud sources need proschi login)`),
  notCached: (spec) => new ImportError(`'${spec}' is not in the import cache (${CACHE_DIR}); run proschi imports sync`),
  altered: (spec) => new ImportError(`The cached copy of '${spec}' does not match its hash in ${LOCK_FILE}; run proschi imports sync`)
};
var isRecord = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function parseLock(text) {
  const invalid = (why) => new ImportError(`Invalid ${LOCK_FILE}: ${why}; delete it and run proschi imports sync`);
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw invalid(e.message);
  }
  if (!isRecord(json) || json.version !== 1) throw invalid('expected {"version": 1, \u2026}');
  const lock = emptyLock();
  const git = json.git ?? {};
  const https = json.https ?? {};
  const cloud = json.cloud ?? {};
  if (!isRecord(git) || !isRecord(https) || !isRecord(cloud)) throw invalid('"git", "https" and "cloud" must be objects');
  for (const [key, entry] of Object.entries(git)) {
    const at = key.lastIndexOf("@");
    const valid = at > 0 && isRecord(entry) && typeof entry.commit === "string" && COMMIT.test(entry.commit) && isRecord(entry.files) && Object.entries(entry.files).every(([path, hash]) => typeof hash === "string" && HASH.test(hash) && isGitSpec(`git:${key.slice(0, at)}//${path}@${key.slice(at + 1)}`));
    if (!valid) throw invalid(`bad git entry '${key}'`);
    lock.git[key] = { commit: entry.commit, files: { ...entry.files } };
  }
  for (const [url, hash] of Object.entries(https)) {
    if (typeof hash !== "string" || !HASH.test(hash) || parseRemoteSpec(url)?.kind !== "https") throw invalid(`bad https entry '${url}'`);
    lock.https[url] = hash;
  }
  for (const [key, entry] of Object.entries(cloud)) {
    const hash = (v) => typeof v === "string" && HASH.test(v);
    const valid = isCanonicalSpec(`cloud:${key}`, "cloud") && isRecord(entry) && typeof entry.tag === "string" && VERSION_TAG.test(entry.tag) && entry.tag !== LATEST_TAG && Number.isSafeInteger(entry.seq) && entry.seq > 0 && hash(entry.sha256) && (entry.source === void 0 || hash(entry.source)) && isRecord(entry.files) && Object.entries(entry.files).every(([path, h2]) => hash(h2) && isCanonicalSpec(`cloud:${key}//${path}`, "cloud"));
    if (!valid) throw invalid(`bad cloud entry '${key}'`);
    lock.cloud[key] = {
      tag: entry.tag,
      seq: entry.seq,
      sha256: entry.sha256,
      ...entry.source === void 0 ? {} : { source: entry.source },
      files: { ...entry.files }
    };
  }
  return lock;
}
function isCanonicalSpec(spec, kind) {
  try {
    const remote = parseRemoteSpec(spec);
    return remote?.kind === kind && formatRemoteSpec(remote) === spec;
  } catch {
    return false;
  }
}
function isGitSpec(spec) {
  try {
    return parseRemoteSpec(spec)?.kind === "git";
  } catch {
    return false;
  }
}
function lockedHash(lock, spec) {
  const remote = parseRemoteSpec(spec);
  if (remote?.kind === "git") return lock.git[gitKey(remote.repo, remote.ref)]?.files[remote.path];
  if (remote?.kind === "https") return lock.https[remote.url];
  if (remote?.kind === "cloud") {
    const entry = lock.cloud[cloudKey(remote.name, remote.tag)];
    return remote.path === void 0 ? entry?.source : entry?.files[remote.path];
  }
  return void 0;
}

// src/terminal/grid.ts
var DEFAULT = 16777216;
var N = 1;
var E = 2;
var S = 4;
var W = 8;
var LINE_GLYPH = {
  [N]: "\u2502",
  [S]: "\u2502",
  [N | S]: "\u2502",
  [E]: "\u2500",
  [W]: "\u2500",
  [E | W]: "\u2500",
  [E | S]: "\u256D",
  [S | W]: "\u256E",
  [N | E]: "\u2570",
  [N | W]: "\u256F",
  [N | E | S]: "\u251C",
  [N | S | W]: "\u2524",
  [E | S | W]: "\u252C",
  [N | E | W]: "\u2534",
  [N | E | S | W]: "\u253C"
};
var HEAVY_GLYPH = {
  [N]: "\u2503",
  [S]: "\u2503",
  [N | S]: "\u2503",
  [E]: "\u2501",
  [W]: "\u2501",
  [E | W]: "\u2501",
  [E | S]: "\u250F",
  [S | W]: "\u2513",
  [N | E]: "\u2517",
  [N | W]: "\u251B",
  [N | E | S]: "\u2523",
  [N | S | W]: "\u252B",
  [E | S | W]: "\u2533",
  [N | E | W]: "\u253B",
  [N | E | S | W]: "\u254B"
};
var Grid = class {
  constructor(columns, rows) {
    this.columns = columns;
    this.rows = rows;
    const size = columns * rows;
    this.glyphs = new Uint32Array(size).fill(32);
    this.fg = new Uint32Array(size).fill(DEFAULT);
    this.bg = new Uint32Array(size).fill(DEFAULT);
    this.lines = new Uint8Array(size);
  }
  columns;
  rows;
  glyphs;
  fg;
  bg;
  /** Line directions per cell, for cells drawn by `line`. */
  lines;
  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.columns && y < this.rows;
  }
  set(x, y, glyph, fg = DEFAULT, bg) {
    if (!this.inside(x, y)) return;
    const i = y * this.columns + x;
    this.glyphs[i] = glyph.codePointAt(0) ?? 32;
    this.fg[i] = fg;
    if (bg !== void 0) this.bg[i] = bg;
    this.lines[i] = 0;
  }
  /** Recolors a cell, keeping its glyph. */
  paint(x, y, fg, bg) {
    if (!this.inside(x, y)) return;
    const i = y * this.columns + x;
    this.fg[i] = fg;
    if (bg !== void 0) this.bg[i] = bg;
  }
  glyph(x, y) {
    return this.inside(x, y) ? String.fromCodePoint(this.glyphs[y * this.columns + x]) : " ";
  }
  /** Writes `text` from (x, y), one cell per character, cut at `max` cells. */
  text(x, y, text, fg = DEFAULT, max = Infinity, bg) {
    let i = 0;
    for (const ch of text) {
      if (i >= max) break;
      this.set(x + i, y, ch, fg, bg);
      i++;
    }
  }
  /** Adds line directions to a cell and redraws it as the glyph that joins them. */
  line(x, y, dirs, fg, heavy = false) {
    if (!this.inside(x, y)) return;
    const i = y * this.columns + x;
    const merged = this.lines[i] | dirs;
    this.glyphs[i] = (heavy ? HEAVY_GLYPH : LINE_GLYPH)[merged].codePointAt(0);
    this.fg[i] = fg;
    this.lines[i] = merged;
  }
  /** The cells as `Raster` takes them: base64 of little-endian u32 triplets. */
  toBase64() {
    const words = new Uint32Array(this.glyphs.length * 3);
    for (let i = 0; i < this.glyphs.length; i++) {
      words[i * 3] = this.glyphs[i];
      words[i * 3 + 1] = this.fg[i];
      words[i * 3 + 2] = this.bg[i];
    }
    return base64(new Uint8Array(words.buffer));
  }
  /** The glyphs alone, trailing spaces trimmed: for tests. */
  toText() {
    const out = [];
    for (let y = 0; y < this.rows; y++) {
      let row = "";
      for (let x = 0; x < this.columns; x++) row += String.fromCodePoint(this.glyphs[y * this.columns + x]);
      out.push(row.trimEnd());
    }
    return out.join("\n");
  }
};
var ALPHABET2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes) {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
    out += ALPHABET2[n >> 18] + ALPHABET2[n >> 12 & 63] + ALPHABET2[n >> 6 & 63] + ALPHABET2[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET2[n >> 18] + ALPHABET2[n >> 12 & 63] + "==";
  } else if (rest === 2) {
    const n = bytes[i] << 16 | bytes[i + 1] << 8;
    out += ALPHABET2[n >> 18] + ALPHABET2[n >> 12 & 63] + ALPHABET2[n >> 6 & 63] + "=";
  }
  return out;
}
function hex(color) {
  return parseInt(color.slice(1), 16);
}

// src/terminal/techIcons.gen.ts
var ICON_NAMES = { "tech": { "Rectangle": "Square", "Circle": "Circle", "Diamond": "Diamond", "Cylinder": "Database", "Cloud": "Cloud", "Actor": "User", "Browser": "Monitor", "Mobile App": "Smartphone", "Note": "FileText", "Load Balancer": "Shuffle", "API Gateway": "DoorOpen", "WAF": "Shield", "Search Engine": "Search", "Data Warehouse": "ChartColumn", "Spring Boot": "SiSpringboot", "Kotlin": "SiKotlin", "Java": "SiOpenjdk", "Go": "SiGo", "Node.js": "SiNodedotjs", "Python": "SiPython", "Django": "SiDjango", "FastAPI": "SiFastapi", "Flask": "SiFlask", "Ruby on Rails": "SiRubyonrails", ".NET": "SiDotnet", "PHP": "SiPhp", "Rust": "SiRust", "Elixir": "SiElixir", "Kubernetes": "SiKubernetes", "Docker": "SiDocker", "Cloudflare Workers": "SiCloudflareworkers", "REST API": "Server", "GraphQL": "SiGraphql", "gRPC": "Server", "WebSocket": "MessageSquare", "SOAP API": "Server", "AWS Lambda": "Zap", "AWS API Gateway": "DoorOpen", "AWS EC2": "Cpu", "AWS ECS": "Container", "AWS EKS": "Container", "AWS Fargate": "Container", "AWS S3": "HardDrive", "AWS EBS": "HardDrive", "AWS EFS": "HardDrive", "AWS RDS": "Database", "AWS DynamoDB": "Database", "AWS ElastiCache": "Database", "AWS Aurora": "Database", "AWS SQS": "MessageSquare", "AWS SNS": "RadioTower", "AWS EventBridge": "RadioTower", "AWS Kinesis": "RadioTower", "AWS CloudFront": "Globe", "AWS Route53": "Network", "AWS Load Balancer": "Shuffle", "GCP Cloud Functions": "Zap", "GCP Cloud Run": "Container", "GCP App Engine": "SiGooglecloud", "GCP Compute Engine": "Cpu", "GCP GKE": "Container", "GCP Cloud Storage": "SiGooglecloudstorage", "GCP Persistent Disk": "HardDrive", "GCP Cloud SQL": "Database", "GCP Firestore": "Database", "GCP Bigtable": "Database", "GCP Spanner": "SiGooglecloudspanner", "GCP BigQuery": "SiGooglebigquery", "GCP Pub/Sub": "SiGooglepubsub", "GCP Cloud CDN": "Globe", "GCP Cloud DNS": "Network", "GCP Load Balancing": "Network", "Azure Functions": "Cloud", "Azure Logic Apps": "Cloud", "Azure API Management": "Cloud", "Azure VM": "Cpu", "Azure AKS": "Container", "Azure Container Instances": "Container", "Azure Blob Storage": "HardDrive", "Azure Files": "HardDrive", "Azure Disk Storage": "HardDrive", "Azure SQL": "Database", "Azure Cosmos DB": "Database", "Azure Database for PostgreSQL": "SiPostgresql", "Azure Database for MySQL": "SiMysql", "Azure Cache for Redis": "SiRedis", "Azure Service Bus": "RadioTower", "Azure Event Hubs": "RadioTower", "Azure Event Grid": "RadioTower", "Azure Queue Storage": "MessageSquare", "Azure CDN": "Globe", "Azure DNS": "Network", "Azure Front Door": "Globe", "PostgreSQL": "SiPostgresql", "MySQL": "SiMysql", "MongoDB": "SiMongodb", "Redis": "SiRedis", "DynamoDB": "Database", "Cassandra": "SiApachecassandra", "CouchDB": "SiCouchbase", "Elasticsearch": "SiElasticsearch", "Neo4j": "SiNeo4J", "InfluxDB": "SiInfluxdb", "TimescaleDB": "SiTimescale", "MariaDB": "SiMariadb", "SQLite": "SiSqlite", "Oracle": "GrOracle", "SQL Server": "Database", "Memcached": "Database", "Hazelcast": "Database", "Aerospike": "Database", "Kafka": "SiApachekafka", "RabbitMQ": "SiRabbitmq", "SQS": "MessageSquare", "Redis Queue": "SiRedis", "NATS": "SiNatsdotio", "Apache Pulsar": "SiApachepulsar", "ActiveMQ": "RadioTower", "ZeroMQ": "MessageSquare", "Third Party API": "ExternalLink", "Payment Gateway": "ExternalLink", "Auth Service": "ExternalLink", "Email Service": "ExternalLink", "SMS Service": "ExternalLink", "Analytics Service": "ExternalLink", "Push Service": "Bell", "Stripe": "SiStripe", "PayPal": "SiPaypal", "Adyen": "SiAdyen", "Braintree": "SiBraintree", "Twilio": "TbBrandTwilio", "SendGrid": "Mail", "Mailgun": "SiMailgun", "Auth0": "SiAuth0", "Okta": "SiOkta", "Google Maps": "SiGooglemaps", "APNs": "Bell", "FCM": "SiFirebase", "OpenAI": "TbBrandOpenai", "AWS SES": "Mail", "AWS Cognito": "KeyRound", "CockroachDB": "SiCockroachlabs", "ScyllaDB": "SiScylladb", "HBase": "SiApachehbase", "etcd": "SiEtcd", "AWS DocumentDB": "Database", "AWS Redshift": "ChartColumn", "AWS OpenSearch": "SiOpensearch", "OpenSearch": "SiOpensearch", "Solr": "SiApachesolr", "Meilisearch": "SiMeilisearch", "Algolia": "SiAlgolia", "Snowflake": "SiSnowflake", "ClickHouse": "SiClickhouse", "Apache Druid": "SiApachedruid", "Databricks": "SiDatabricks", "Prometheus": "SiPrometheus", "Valkey": "SiRedis", "KeyDB": "SiRedis", "GCP Memorystore": "SiRedis", "MinIO": "SiMinio", "Cloudflare R2": "SiCloudflare", "Redpanda": "SiApachekafka", "AWS MSK": "SiApachekafka", "Cloudflare": "SiCloudflare", "Fastly": "SiFastly", "Akamai": "SiAkamai", "nginx": "SiNginx", "Envoy": "SiEnvoyproxy", "HAProxy": "Shuffle", "Traefik": "SiTraefikproxy", "Kubernetes Ingress": "SiKubernetes", "Kong": "SiKong", "Spring Cloud Gateway": "SiSpringboot", "AWS WAF": "Shield", "AWS Global Accelerator": "Globe", "Azure Load Balancer": "Network", "Azure Application Gateway": "Network", "Text Note": "StickyNote", "Sticky Note": "StickyNote", "Comment": "FileText", "Logical Group": "FolderOpen", "Network Boundary": "Box", "Security Zone": "Box", "Service Group": "Layers" }, "type": { "shape": "Square", "service": "Server", "database": "Database", "queue": "MessageSquare", "broker": "RadioTower", "external": "ExternalLink", "serverless": "Zap", "compute": "Cpu", "container": "Container", "storage": "HardDrive", "cache": "Layers", "cdn": "Globe", "text": "StickyNote", "group": "FolderOpen" } };

// src/terminal/icons.ts
var NERD = {
  // Lucide
  Bell: 60066,
  Box: 61874,
  ChartColumn: 61568,
  Circle: 60092,
  Cloud: 60330,
  Container: 62647,
  Cpu: 62652,
  Database: 61888,
  Diamond: 62655,
  DoorOpen: 60917,
  ExternalLink: 61582,
  FileText: 61788,
  FolderOpen: 61564,
  Globe: 61612,
  HardDrive: 61600,
  KeyRound: 61572,
  Layers: 60370,
  Mail: 60188,
  MessageSquare: 62074,
  Monitor: 61704,
  Network: 61193,
  RadioTower: 60212,
  Search: 60013,
  Server: 62003,
  Shield: 61746,
  Shuffle: 61556,
  Smartphone: 60680,
  Square: 60018,
  StickyNote: 62025,
  User: 61447,
  Zap: 61671,
  // Brands
  GrOracle: 59481,
  SiAlgolia: 59146,
  SiApachecassandra: 59273,
  SiApachekafka: 59182,
  SiApachepulsar: 59506,
  SiClickhouse: 59646,
  SiCloudflare: 59282,
  SiCloudflareworkers: 59283,
  SiCouchbase: 59296,
  SiDjango: 59165,
  SiDocker: 59312,
  SiDotnet: 59263,
  SiElasticsearch: 59338,
  SiElixir: 59341,
  SiEnvoyproxy: 59345,
  SiFastapi: 59349,
  SiFirebase: 59271,
  SiFlask: 59356,
  SiGo: 59172,
  SiGooglecloud: 59377,
  SiGraphql: 59380,
  SiInfluxdb: 59392,
  SiKotlin: 59419,
  SiKubernetes: 59421,
  SiMariadb: 59432,
  SiMongodb: 59300,
  SiMysql: 59140,
  SiNatsdotio: 59632,
  SiNeo4J: 59449,
  SiNginx: 59254,
  SiNodedotjs: 59161,
  SiOkta: 59472,
  SiOpenjdk: 59192,
  SiPaypal: 61933,
  SiPhp: 59197,
  SiPostgresql: 59246,
  SiPrometheus: 59504,
  SiPython: 59196,
  SiRabbitmq: 59522,
  SiRedis: 59245,
  SiRubyonrails: 59195,
  SiRust: 59304,
  SiSnowflake: 62172,
  SiSpringboot: 59564,
  SiSqlite: 59332,
  SiStripe: 60755,
  SiTraefikproxy: 59591,
  TbBrandOpenai: 60545,
  TbBrandTwilio: 59726
};
var SYMBOL = {
  client: "\u25EF",
  edge: "\u25C7",
  cdn: "\u25CD",
  loadbalancer: "\u21C4",
  gateway: "\u2290",
  dns: "\u22D4",
  service: "\u25A3",
  function: "\u21AF",
  cache: "\u2261",
  database: "\u25C9",
  search: "\u2315",
  analytics: "\u25A5",
  storage: "\u25AD",
  queue: "\u224B",
  broker: "\u25CE",
  external: "\u2197",
  other: "\u25A2"
};
function iconOf(node, style) {
  if (style === "none" || node.kind !== "component") return void 0;
  if (style === "symbols") return SYMBOL[kindOf(node)];
  const own = ICON_NAMES.tech[node.techStack];
  const name = own && NERD[own] ? own : ICON_NAMES.type[node.type] ?? "Server";
  return String.fromCodePoint(NERD[name] ?? NERD.Server);
}

// ../frontend/src/dsl/edgePath.ts
function labelPoint(points) {
  let best = { x: points[0]?.x ?? 0, y: points[0]?.y ?? 0 };
  let longest = -1;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > longest) {
      longest = len;
      best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return best;
}
function fallbackRoute(s, t) {
  const sc = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
  const tc = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
  const gapY = Math.max(t.y - (s.y + s.height), s.y - (t.y + t.height));
  const gapX = Math.max(t.x - (s.x + s.width), s.x - (t.x + t.width));
  if (gapY >= 0 || gapY >= gapX) {
    const down = tc.y >= sc.y;
    const from2 = { x: sc.x, y: down ? s.y + s.height : s.y };
    const to2 = { x: tc.x, y: down ? t.y : t.y + t.height };
    if (Math.abs(from2.x - to2.x) < 1) return [from2, to2];
    const midY = (from2.y + to2.y) / 2;
    return [from2, { x: from2.x, y: midY }, { x: to2.x, y: midY }, to2];
  }
  const right = tc.x >= sc.x;
  const from = { x: right ? s.x + s.width : s.x, y: sc.y };
  const to = { x: right ? t.x : t.x + t.width, y: tc.y };
  if (Math.abs(from.y - to.y) < 1) return [from, to];
  const midX = (from.x + to.x) / 2;
  return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
}

// src/terminal/scene.ts
var SX = 8;
var SY = 12;
var MAX_SX = 16;
var SQUEEZE_SX = 20;
var MARGIN = 1;
var SYSTEM_ROWS = 6;
function buildScene(diagram, layout, maxColumns = 160) {
  const widthPx = layoutWidth(diagram, layout);
  let sx = Math.min(MAX_SX, Math.max(SX, widthPx / Math.max(1, maxColumns - 2 * MARGIN - 1)));
  let scene = sceneAt(diagram, layout, sx);
  for (let tries = 0; tries < 8 && scene.columns > maxColumns && sx < SQUEEZE_SX; tries++) {
    sx = Math.min(SQUEEZE_SX, sx * Math.max(1.05, (scene.columns + 2) / maxColumns));
    const narrower = sceneAt(diagram, layout, sx);
    if (narrower.columns < scene.columns) scene = narrower;
  }
  return scene;
}
function layoutWidth(diagram, layout) {
  const { xs, minX } = extent(diagram, layout);
  return Math.max(1, ...xs) - minX;
}
function extent(diagram, layout) {
  const boxes = new Map(layout.nodes.map((b) => [b.id, b]));
  const absolute = (id) => {
    const b = boxes.get(id);
    if (!b) return { x: 0, y: 0 };
    const parent = b.parent ? absolute(b.parent) : { x: 0, y: 0 };
    return { x: parent.x + b.position.x, y: parent.y + b.position.y };
  };
  const px = diagram.nodes.filter((n) => boxes.has(n.id)).map((node) => ({ node, at: absolute(node.id), box: boxes.get(node.id) }));
  const bends = Object.values(layout.routes).flatMap((r) => r.points);
  const xs = [...px.flatMap((p) => [p.at.x, p.at.x + p.box.width]), ...bends.map((p) => p.x)];
  const ys = [...px.flatMap((p) => [p.at.y, p.at.y + p.box.height]), ...bends.map((p) => p.y)];
  return { px, xs, minX: Math.min(0, ...xs), minY: Math.min(0, ...ys) };
}
function sceneAt(diagram, layout, sx) {
  const { px, minX, minY } = extent(diagram, layout);
  const cx = (x) => Math.round((x - minX) / sx) + MARGIN;
  const cy = (y) => Math.round((y - minY) / SY) + MARGIN;
  const depthOf = (n) => {
    const parent = n.parent ? diagram.nodes.find((p) => p.id === n.parent) : void 0;
    return parent ? depthOf(parent) + 1 : 0;
  };
  const nodes = /* @__PURE__ */ new Map();
  for (const { node, at, box } of px) {
    const x = cx(at.x);
    const y = cy(at.y);
    const w = Math.max(node.kind === "group" ? 8 : 6, cx(at.x + box.width) - x);
    const h2 = node.kind === "component" ? 5 : node.kind === "system" ? SYSTEM_ROWS : Math.max(node.kind === "group" ? 3 : 4, cy(at.y + box.height) - y);
    nodes.set(node.id, { node, rect: { x, y, w, h: h2 }, depth: depthOf(node) });
  }
  const edges = [];
  for (const edge of diagram.edges) {
    const s = nodes.get(edge.source);
    const t = nodes.get(edge.target);
    if (!s || !t || s === t) continue;
    const route = layout.routes[edge.id];
    const points = route ? route.points.map((p) => ({ x: cx(p.x), y: cy(p.y) })) : void 0;
    const path = points ? routePath(points, s.rect, t.rect) : fallbackPath(s.rect, t.rect);
    if (!path) continue;
    const at = route?.label ? { x: cx(route.label.x), y: cy(route.label.y) } : labelPoint(path.cells);
    edges.push({ edge, path, ...edge.label ? { label: { x: Math.round(at.x), y: Math.round(at.y) } } : {} });
  }
  compact(nodes, edges);
  let right = 0;
  let bottom = 0;
  for (const { node, rect } of nodes.values()) {
    const cast = stacked(node) ? 1 : 0;
    right = Math.max(right, rect.x + rect.w + cast);
    bottom = Math.max(bottom, rect.y + rect.h + cast);
  }
  for (const { path } of edges)
    for (const c of path.cells) {
      right = Math.max(right, c.x + 1);
      bottom = Math.max(bottom, c.y + 1);
    }
  for (const e of edges) if (e.label && e.edge.label) right = Math.max(right, e.label.x + Math.ceil(e.edge.label.length / 2) + 1);
  const legend = diagram.legend ?? [];
  const legendRows = legend.length ? legend.length + 3 : 0;
  if (legend.length) right = Math.max(right, MARGIN + legendWidth(legend.map((e) => e.label)));
  return {
    diagram,
    columns: Math.min(512, Math.max(1, right + MARGIN)),
    rows: Math.min(256, Math.max(1, bottom + MARGIN + legendRows)),
    nodes,
    edges,
    legendRow: bottom + MARGIN
  };
}
function stacked(node, replicas) {
  return node.kind === "component" && (replicas ?? node.replicas ?? 1) > 1;
}
function legendWidth(labels) {
  return Math.max(10, 1 + 1 + 3 + 1 + Math.max(0, ...labels.map((l) => l.length)) + 1 + 1);
}
var contains = (r, c) => c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h;
function attach(end, next, r) {
  const vertical = end.x === next.x;
  if (vertical && end.x >= r.x && end.x < r.x + r.w) {
    if (end.y >= r.y + r.h) return { x: end.x, y: r.y + r.h - 1 };
    if (end.y < r.y) return { x: end.x, y: r.y };
  }
  if (!vertical && end.y >= r.y && end.y < r.y + r.h) {
    if (end.x >= r.x + r.w) return { x: r.x + r.w - 1, y: end.y };
    if (end.x < r.x) return { x: r.x, y: end.y };
  }
  return end;
}
function segment(a, b, out) {
  const corner = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x) ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
  for (const [from, to] of [
    [a, corner],
    [corner, b]
  ]) {
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);
    let { x, y } = from;
    while (x !== to.x || y !== to.y) {
      x += dx;
      y += dy;
      out.push({ x, y });
    }
  }
}
var dirTo = (a, b) => b.x > a.x ? E : b.x < a.x ? W : b.y > a.y ? S : N;
var opposite = (d) => d === N ? S : d === S ? N : d === E ? W : E;
function unjog(pts, box) {
  const n = pts.length;
  if (n < 3) return pts;
  const [a, b, c] = [pts[n - 3], pts[n - 2], pts[n - 1]];
  const sideways = a.y === b.y && Math.abs(b.x - a.x) <= 4 && b.x === c.x && Math.abs(c.y - b.y) <= 3;
  if (!sideways || a.x < box.x + 1 || a.x > box.x + box.w - 2) return pts;
  return [...pts.slice(0, n - 2), { x: a.x, y: c.y }];
}
function undetour(pts) {
  const out = pts.slice();
  for (let i = 0; i + 3 < out.length; i++) {
    const [a, b, c, d] = out.slice(i, i + 4);
    const down = a.y === b.y && b.x === c.x && c.y === d.y && a.x === d.x && Math.abs(b.x - a.x) <= 6 && Math.abs(c.y - b.y) <= 4;
    const across = a.x === b.x && b.y === c.y && c.x === d.x && a.y === d.y && Math.abs(b.y - a.y) <= 3 && Math.abs(c.x - b.x) <= 8;
    if (down || across) out.splice(i + 1, 2);
  }
  return out;
}
function routePath(points, from, to) {
  if (points.length < 2) return void 0;
  const pts = unjog(unjog(undetour(points), to).reverse(), from).reverse();
  pts[0] = attach(pts[0], pts[1], from);
  pts[pts.length - 1] = attach(pts[pts.length - 1], pts[pts.length - 2], to);
  const all = [pts[0]];
  for (let i = 1; i < pts.length; i++) segment(pts[i - 1], pts[i], all);
  const run = [];
  for (const c of all) {
    const last2 = run[run.length - 1];
    if (last2 && last2.x === c.x && last2.y === c.y) continue;
    run.push(c);
  }
  let start2 = 0;
  while (start2 < run.length && contains(from, run[start2])) start2++;
  let end = run.length - 1;
  while (end >= start2 && contains(to, run[end])) end--;
  const cells = run.slice(start2, end + 1);
  if (cells.length === 0) return void 0;
  const before2 = run[start2 - 1] ?? void 0;
  const after2 = run[end + 1] ?? void 0;
  const dirs = cells.map((c, i) => {
    let d = 0;
    const prev = i > 0 ? cells[i - 1] : before2;
    const next = i < cells.length - 1 ? cells[i + 1] : void 0;
    if (prev) d |= dirTo(c, prev);
    if (next) d |= dirTo(c, next);
    return d;
  });
  const last = cells[cells.length - 1];
  const head = after2 ? dirTo(last, after2) : cells.length > 1 ? opposite(dirTo(last, cells[cells.length - 2])) : S;
  return { cells, dirs, head };
}
function fallbackPath(from, to) {
  const box = (r) => ({ x: r.x, y: r.y, width: r.w - 1, height: r.h - 1 });
  const points = fallbackRoute(box(from), box(to)).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  return routePath(points, from, to);
}
var LINE = 1;
var FRAME = 2;
var CARD = 3;
function gapRows(a, b) {
  if (a === CARD || b === CARD) return 1;
  return a === FRAME && b === FRAME ? 1 : 0;
}
function gapColumns(a, b) {
  if (a === CARD && b === CARD) return 3;
  if (a === FRAME && b === FRAME) return 2;
  return 1;
}
function squeeze(kinds, gap) {
  const to = new Array(kinds.length).fill(-1);
  let next = 0;
  let prev = 0;
  for (let i = 0; i < kinds.length; ) {
    if (kinds[i]) {
      prev = kinds[i];
      to[i++] = next++;
      continue;
    }
    let end = i;
    while (end < kinds.length && !kinds[end]) end++;
    if (end === kinds.length) break;
    const keep = Math.min(end - i, prev ? gap(prev, kinds[end]) : MARGIN);
    for (let k = 0; k < keep; k++) to[i + k] = next++;
    i = end;
  }
  return to;
}
function compact(nodes, edges) {
  const rows = [];
  const cols = [];
  const mark = (at, i, kind) => {
    if (i >= 0) at[i] = Math.max(at[i] ?? 0, kind);
  };
  for (const { node, rect } of nodes.values()) {
    if (node.kind === "group") {
      mark(rows, rect.y, FRAME);
      mark(rows, rect.y + rect.h - 1, FRAME);
      mark(cols, rect.x, FRAME);
      mark(cols, rect.x + rect.w - 1, FRAME);
      for (let x = rect.x + 1; x < Math.min(rect.x + rect.w - 1, rect.x + 4 + node.name.length + 1); x++) mark(cols, x, FRAME);
      continue;
    }
    const cast = stacked(node) ? 1 : 0;
    for (let y = rect.y; y < rect.y + rect.h + cast; y++) mark(rows, y, CARD);
    for (let x = rect.x; x < rect.x + rect.w + cast; x++) mark(cols, x, CARD);
  }
  for (const { edge, path, label } of edges) {
    path.cells.forEach((c, i) => {
      const last = i === path.cells.length - 1;
      if (last || path.dirs[i] !== (N | S)) mark(rows, c.y, LINE);
      if (last || path.dirs[i] !== (E | W)) mark(cols, c.x, LINE);
    });
    if (label && edge.label) {
      mark(rows, label.y, LINE);
      const left = label.x - Math.floor((edge.label.length + 2) / 2);
      for (let x = left; x < left + edge.label.length + 2; x++) mark(cols, x, LINE);
    }
  }
  const dense = (at) => Array.from({ length: at.length }, (_, i) => at[i] ?? 0);
  const toRow = squeeze(dense(rows), gapRows);
  const toCol = squeeze(dense(cols), gapColumns);
  const row = (y) => toRow[y] ?? y;
  const col = (x) => x < 0 ? x : toCol[x] ?? x;
  for (const n of nodes.values()) {
    const { x, y, w, h: h2 } = n.rect;
    n.rect = { x: col(x), y: row(y), w: col(x + w - 1) - col(x) + 1, h: row(y + h2 - 1) - row(y) + 1 };
  }
  for (const e of edges) {
    const cells = [];
    const dirs = [];
    e.path.cells.forEach((c, i) => {
      if (toRow[c.y] === -1 || toCol[c.x] === -1) return;
      cells.push({ x: col(c.x), y: row(c.y) });
      dirs.push(e.path.dirs[i]);
    });
    e.path = { cells, dirs, head: e.path.head };
    if (e.label) e.label = { x: col(e.label.x), y: row(e.label.y) };
  }
}

// src/terminal/paint.ts
var COLOR = {
  muted: 9146264,
  line: 10265519,
  critical: 15680580,
  note: 15381256,
  /** Playback, as the canvas's tokens (design/tokens.css): the pink packet and lit node, the fail red. */
  pink: 16735650,
  fail: 16726832,
  /** Dark text on a solid palette color or the accent: readable on any of them, on any terminal. */
  onColor: 1118481,
  /**
   * What playback fades: the scenario's path loses its colors, the rest turns
   * a mid grey drawn dotted. Mid greys sit back on dark and light terminals
   * alike, where a darker or lighter grey would stand out on one of them.
   */
  faded: 10265519,
  fadedMore: 8028040,
  good: 2278750,
  warn: 15381256,
  bad: 15680580,
  /** The canvas's load overlay (utils/heat.ts): a busy card's fill, from yellow through pink to red. */
  heatWarm: 16765503,
  heatHot: 16743092,
  heatOver: 16739169
};
var HEAD = { [N]: "\u25B2", [S]: "\u25BC", [E]: "\u25BA", [W]: "\u25C4" };
function lookOf(play, id) {
  if (!play) return void 0;
  if (play.failing.has(id)) return "failing";
  if (play.active.has(id)) return "lit";
  return play.pathNodes.has(id) ? "path" : "off";
}
var fade = (look, color) => look === "path" ? COLOR.faded : look === "off" ? COLOR.fadedMore : color;
function paint(scene, options = {}) {
  const grid = new Grid(scene.columns, scene.rows);
  const { play } = options;
  const all = [...scene.nodes.values()];
  const frameOf2 = (n) => isFrame(n.node) ? { badge: options.systems?.[n.node.id], selected: options.selected === n.node.id } : void 0;
  for (const g of all.filter((n) => n.node.kind === "group").sort((a, b) => a.depth - b.depth)) drawGroup(grid, g, play ? "path" : void 0, frameOf2(g));
  for (const n of all) drawStack(grid, scene, n, options.overlay?.[n.node.id], lookOf(play, n.node.id));
  for (const { edge, path } of scene.edges) {
    const own = edge.style?.color ? hex(edge.style.color) : COLOR.line;
    const off = !!play && !play.pathEdges.has(edge.id);
    const color = play ? off ? COLOR.fadedMore : COLOR.faded : own;
    drawPath(grid, path, color, off ? "dotted" : edge.style?.dash);
  }
  for (const active of play?.edges ?? []) {
    const color = active.error ? COLOR.fail : DEFAULT;
    const { cells, dirs, head } = active.path;
    for (let i = 0; i < cells.length - 1; i++) {
      const straight = dirs[i] === (N | S) || dirs[i] === (E | W);
      const gap = active.failed ? i % 2 === 1 : active.flowing && (i + 3 * 1e3 - play.tick) % 3 === 0;
      if (straight && gap) grid.set(cells[i].x, cells[i].y, dirs[i] === (N | S) ? "\u254F" : "\u254D", color);
      else grid.line(cells[i].x, cells[i].y, dirs[i], color, true);
    }
    const last = cells[cells.length - 1];
    grid.set(last.x, last.y, HEAD[head], color);
  }
  const taken = /* @__PURE__ */ new Set();
  for (const { edge, label } of scene.edges) {
    if (!label || !edge.label) continue;
    const text = ` ${edge.label} `;
    const x = label.x - Math.floor(text.length / 2);
    const free = (y2) => y2 >= 0 && y2 < grid.rows && Array.from(text, (_, i) => `${x + i},${y2}`).every((k) => !taken.has(k));
    const y = [0, -1, 1, -2, 2].map((d) => label.y + d).find(free) ?? label.y;
    const color = play && !play.pathEdges.has(edge.id) ? COLOR.fadedMore : COLOR.muted;
    for (let i = 0; i < text.length; i++) {
      taken.add(`${x + i},${y}`);
      if (!onCard(scene, x + i, y)) grid.set(x + i, y, text[i], color);
    }
  }
  for (const g of all) if (g.node.kind === "group") drawGroupHeading(grid, g, play ? "path" : void 0, frameOf2(g));
  for (const n of all) drawStackCount(grid, scene, n, options.overlay?.[n.node.id], lookOf(play, n.node.id));
  for (const packet of play?.packets ?? []) grid.set(packet.at.x, packet.at.y, packet.cut ? "\u2717" : "\u25A0", packet.error ? COLOR.fail : COLOR.pink);
  for (const n of all) {
    if (n.node.kind === "group") continue;
    const look = lookOf(play, n.node.id);
    if (n.node.kind === "text") drawNote(grid, n, look);
    else if (n.node.kind === "system") drawSystem(grid, n, options.systems?.[n.node.id], look, options.selected === n.node.id);
    else drawCard(grid, scene, n, options.overlay?.[n.node.id], look, options.icons ?? "nerd-font");
  }
  drawLegend(grid, scene);
  return grid;
}
function onCard(scene, x, y) {
  for (const { node, rect } of scene.nodes.values()) {
    if (node.kind === "group") continue;
    if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) return true;
  }
  return false;
}
function drawPath(grid, path, color, dash) {
  const { cells, dirs, head } = path;
  const g = dash ? LINES[dash] : void 0;
  for (let i = 0; i < cells.length - 1; i++) {
    const { x, y } = cells[i];
    const straight = dirs[i] === (N | S) || dirs[i] === (E | W);
    if (g && straight) grid.set(x, y, dirs[i] === (N | S) ? g.v : g.h, color);
    else grid.line(x, y, dirs[i], color);
  }
  const last = cells[cells.length - 1];
  grid.set(last.x, last.y, HEAD[head], color);
}
function baseColor(node, fallback) {
  const base = nodeBaseColor(node);
  return base ? hex(base) : fallback;
}
var LINES = {
  solid: { h: "\u2500", v: "\u2502" },
  dashed: { h: "\u254C", v: "\u254E" },
  dotted: { h: "\u2508", v: "\u250A" }
};
var HEAVY_LINES = {
  solid: { h: "\u2501", v: "\u2503" },
  dashed: { h: "\u254D", v: "\u254F" },
  dotted: { h: "\u2505", v: "\u2507" }
};
function frame(grid, r, color, dash = "solid", heavy = false) {
  const right = r.x + r.w - 1;
  const bottom = r.y + r.h - 1;
  const { h: h2, v } = (heavy ? HEAVY_LINES : LINES)[dash];
  const [tl, tr, bl, br] = heavy ? "\u250F\u2513\u2517\u251B" : "\u256D\u256E\u2570\u256F";
  for (let x = r.x + 1; x < right; x++) {
    grid.set(x, r.y, h2, color);
    grid.set(x, bottom, h2, color);
  }
  for (let y = r.y + 1; y < bottom; y++) {
    grid.set(r.x, y, v, color);
    grid.set(right, y, v, color);
  }
  grid.set(r.x, r.y, tl, color);
  grid.set(right, r.y, tr, color);
  grid.set(r.x, bottom, bl, color);
  grid.set(right, bottom, br, color);
}
function fill(grid, r, fg, bg) {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) grid.set(x, y, " ", fg, bg);
}
var fit = (text, room) => text.length <= room ? text : room <= 1 ? "\u2026".slice(0, room) : text.slice(0, room - 1) + "\u2026";
var isFrame = (node) => node.kind === "group" && node.system === node.id;
function statusColor(status, ok) {
  if (status === "saturated" || status === "breach") return COLOR.fail;
  if (status === "hot") return COLOR.warn;
  return status === "idle" ? COLOR.muted : ok;
}
var STATUS = { ok: "\u2713 ok", hot: "\u25B2 hot", saturated: "\u2717 saturated", breach: "\u2717 breaks SLA", idle: "not simulated" };
function doubleFrame(grid, r, color) {
  const right = r.x + r.w - 1;
  const bottom = r.y + r.h - 1;
  for (let x = r.x + 1; x < right; x++) {
    grid.set(x, r.y, "\u2550", color);
    grid.set(x, bottom, "\u2550", color);
  }
  for (let y = r.y + 1; y < bottom; y++) {
    grid.set(r.x, y, "\u2551", color);
    grid.set(right, y, "\u2551", color);
  }
  grid.set(r.x, r.y, "\u2554", color);
  grid.set(right, r.y, "\u2557", color);
  grid.set(r.x, bottom, "\u255A", color);
  grid.set(right, bottom, "\u255D", color);
}
function drawGroup(grid, { node, rect }, look, system) {
  if (system) return doubleFrame(grid, rect, system.selected ? COLOR.pink : fade(look, statusColor(system.badge?.status, baseColor(node, COLOR.muted))));
  frame(grid, rect, fade(look, baseColor(node, COLOR.muted)), node.style?.dash ?? "dashed");
}
function drawGroupHeading(grid, { node, rect }, look, system) {
  const color = system ? system.selected ? COLOR.pink : fade(look, statusColor(system.badge?.status, baseColor(node, COLOR.muted))) : fade(look, baseColor(node, COLOR.muted));
  const name = node.name.toUpperCase();
  const badge = system?.badge;
  const room = rect.w - 5;
  let about = "";
  if (badge) {
    let parts = [STATUS[badge.status], badge.team ? `@${badge.team}` : "", badge.promise ?? "", loadText(badge)];
    const width = () => name.length + 2 + parts.filter(Boolean).join(" \xB7 ").length;
    for (const drop of [3, 2, 1]) if (width() > room) parts = parts.map((p, i) => i === drop ? "" : p);
    about = parts.filter(Boolean).join(" \xB7 ");
  }
  const chip2 = ` ${fit(name, badge ? Math.max(4, room - 2 - about.length) : rect.w - 6)} `;
  grid.text(rect.x + 2, rect.y, chip2, COLOR.onColor, Infinity, color);
  const rest = room - chip2.length;
  if (about && rest > 4) grid.text(rect.x + 2 + chip2.length, rect.y, `${fit(about, rest)} `, look ? COLOR.fadedMore : color);
  if (!node.description || rect.h <= 3) return;
  grid.text(rect.x + 2, rect.y + 1, fit(node.description.replace(/\s+/g, " "), rect.w - 4), look ? COLOR.fadedMore : COLOR.muted);
}
function drawSystem(grid, { node, rect }, badge, look, selected) {
  const accent = look === "failing" ? COLOR.fail : look === "lit" || selected ? COLOR.pink : void 0;
  const status = badge?.status;
  const color = accent ?? fade(look, statusColor(status, baseColor(node, COLOR.line)));
  const heat = look || !badge || badge.utilization === void 0 ? void 0 : heatOf({ utilization: badge.utilization, saturated: status === "saturated" });
  const ink = heat !== void 0 ? COLOR.onColor : look === "off" ? COLOR.fadedMore : DEFAULT;
  const muted = heat !== void 0 ? COLOR.onColor : look === "off" ? COLOR.fadedMore : COLOR.muted;
  fill(grid, rect, DEFAULT, DEFAULT);
  if (heat !== void 0) fill(grid, { x: rect.x + 1, y: rect.y + 1, w: rect.w - 2, h: rect.h - 2 }, COLOR.onColor, heat);
  doubleFrame(grid, rect, color);
  const left = rect.x + 2;
  const room = rect.w - 4;
  if (status && rect.w > 14) {
    const word = ` ${fit(STATUS[status], rect.w - 8)} `;
    grid.text(rect.x + rect.w - 2 - word.length, rect.y, word, look ? muted : statusColor(status, COLOR.muted));
  }
  grid.text(left, rect.y + 1, fit(node.name, room), ink, Infinity, heat);
  grid.text(left, rect.y + 2, fit(badge?.team ? `@${badge.team}` : "system", room), muted, Infinity, heat);
  if (!badge) return;
  grid.text(left, rect.y + 3, fit(badge.promise ? `promise ${badge.promise}` : "no promise", room), badge.promise ? ink : muted, Infinity, heat);
  if (rect.h < 6) return;
  const long = `${loadText(badge)} sent / headroom`;
  const text = fit(long.length <= room ? long : loadText(badge), room);
  grid.text(left, rect.y + 4, text, ink, Infinity, heat);
  const bar = room - text.length - 1;
  if (bar < 4 || !Number.isFinite(badge.headroomRps) || badge.headroomRps <= 0) return;
  const share2 = badge.sentRps / badge.headroomRps;
  const filled = Math.max(share2 > 0 ? 1 : 0, Math.min(bar, Math.round(share2 * bar)));
  for (let i = 0; i < bar; i++) {
    const full = i < filled;
    grid.set(left + text.length + 1 + i, rect.y + 4, full ? "\u2501" : "\u2500", heat !== void 0 ? COLOR.onColor : full ? ink : COLOR.muted, heat);
  }
}
var TILE = { w: 5, h: 3 };
function heatOf(overlay) {
  const u = overlay?.utilization;
  if (!overlay || overlay.down || u === void 0) return void 0;
  if (overlay.saturated || u >= 1) return COLOR.heatOver;
  if (u >= 0.9) return COLOR.heatHot;
  return u >= 0.7 ? COLOR.heatWarm : void 0;
}
var replicasOf2 = (node, overlay) => overlay?.replicas ?? node.replicas ?? 1;
function stackRoom(grid, scene, { node, rect }) {
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  if (!grid.inside(right, bottom)) return false;
  for (const other of scene.nodes.values()) {
    if (other.node === node || other.node.kind === "group") continue;
    const r = other.rect;
    const hitsRight = right >= r.x && right < r.x + r.w && r.y <= bottom && r.y + r.h > rect.y + 1;
    const hitsBottom = bottom >= r.y && bottom < r.y + r.h && r.x <= right && r.x + r.w > rect.x + 1;
    if (hitsRight || hitsBottom) return false;
  }
  return true;
}
var stackShown = (grid, scene, n, overlay) => stacked(n.node, replicasOf2(n.node, overlay)) && stackRoom(grid, scene, n);
function drawStack(grid, scene, n, overlay, look) {
  if (!stackShown(grid, scene, n, overlay)) return;
  const { node, rect } = n;
  const color = look ? look === "off" ? COLOR.fadedMore : COLOR.faded : overlay?.down ? COLOR.muted : baseColor(node, COLOR.line);
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  const { h: h2, v } = LINES[look === "off" ? "dotted" : "solid"];
  for (let y = rect.y + 2; y < bottom; y++) grid.set(right, y, v, color);
  for (let x = rect.x + 2; x < right; x++) grid.set(x, bottom, h2, color);
  grid.set(right, rect.y + 1, "\u256E", color);
  grid.set(rect.x + 1, bottom, "\u2570", color);
  grid.set(right, bottom, "\u256F", color);
}
function drawStackCount(grid, scene, n, overlay, look) {
  if (!stackShown(grid, scene, n, overlay)) return;
  const { rect } = n;
  const count = ` \xD7${replicasOf2(n.node, overlay)} `;
  if (rect.w > count.length + 4) grid.text(rect.x + rect.w - 1 - count.length, rect.y + rect.h, count, look === "off" ? COLOR.fadedMore : COLOR.muted);
}
function drawCard(grid, scene, n, overlay, look, icons2) {
  const { node, rect } = n;
  const down = !!overlay?.down;
  const over = !down && !!overlay && (!!overlay.saturated || (overlay.utilization ?? 0) >= 1);
  const heat = look ? void 0 : heatOf(overlay);
  const accent = look === "failing" ? COLOR.fail : look === "lit" ? COLOR.pink : void 0;
  const color = accent ?? (down && !look ? COLOR.muted : over && !look ? COLOR.fail : fade(look, baseColor(node, COLOR.line)));
  const faded = look === "path" || look === "off" || down;
  const ink = heat !== void 0 ? COLOR.onColor : look === "off" || down ? COLOR.fadedMore : DEFAULT;
  const muted = heat !== void 0 ? COLOR.onColor : look === "off" ? COLOR.fadedMore : COLOR.muted;
  fill(grid, rect, DEFAULT, DEFAULT);
  if (heat !== void 0) fill(grid, { x: rect.x + 1, y: rect.y + 1, w: rect.w - 2, h: rect.h - 2 }, COLOR.onColor, heat);
  frame(grid, rect, color, look === "off" || down ? "dotted" : accent ? "solid" : node.style?.dash ?? "solid", true);
  const icon = iconOf(node, icons2);
  const tiled = icon !== void 0 && rect.w >= 22;
  if (tiled) {
    const tile = { x: rect.x + 2, y: rect.y + 1, w: TILE.w, h: TILE.h };
    if (faded) grid.set(tile.x + 2, tile.y + 1, icon, color, heat);
    else {
      fill(grid, tile, COLOR.onColor, color);
      grid.set(tile.x + 2, tile.y + 1, icon, COLOR.onColor, color);
    }
  }
  const left = rect.x + (tiled ? 2 + TILE.w + 2 : 2);
  const room = rect.x + rect.w - 2 - left;
  grid.text(left, rect.y + 1, fit(node.name, room), ink, Infinity, heat);
  grid.text(left, rect.y + 2, fit(node.techStack, room), muted, Infinity, heat);
  const load = overlay ? loadRow(grid, { x: left, y: rect.y + 3, room }, node, overlay, look, heat, stackShown(grid, scene, n, overlay)) : false;
  if (!load && node.ownerTeam) grid.text(left, rect.y + 3, fit(`Team: ${node.ownerTeam}`, room), muted, Infinity, heat);
  if (node.critical) grid.text(rect.x + rect.w - 4, rect.y, " ! ", look === "off" ? muted : COLOR.critical);
}
function loadRow(grid, at, node, o, look, heat, stack) {
  const u = o.utilization;
  const replicas = replicasOf2(node, o);
  const parts = [
    replicas > 1 && !stack ? `\xD7${replicas}` : "",
    o.size ?? "",
    o.shards && o.shards > 1 ? `\u29C9${o.shards}` : "",
    o.down ? "down" : u !== void 0 ? `${Math.round(u * 100)}%` : ""
  ].filter(Boolean);
  if (parts.length === 0) return false;
  const text = fit(parts.join(" \xB7 "), at.room);
  const on = heat !== void 0;
  const ink = on ? COLOR.onColor : look === "off" || o.down ? COLOR.fadedMore : look ? COLOR.muted : DEFAULT;
  grid.text(at.x, at.y, text, ink, Infinity, heat);
  const bar = at.room - text.length - 1;
  if (u === void 0 || o.down || bar < 4) return true;
  const filled = Math.max(u > 0 ? 1 : 0, Math.min(bar, Math.round(u * bar)));
  for (let i = 0; i < bar; i++) {
    const full = i < filled;
    grid.set(at.x + text.length + 1 + i, at.y, full ? "\u2501" : "\u2500", on ? COLOR.onColor : full ? ink : COLOR.muted, heat);
  }
  return true;
}
function drawNote(grid, { node, rect }, look) {
  const muted = look === "off" ? COLOR.fadedMore : COLOR.muted;
  fill(grid, rect, DEFAULT, DEFAULT);
  frame(grid, rect, fade(look, COLOR.note), look === "off" ? "dotted" : "solid");
  const room = rect.w - 4;
  grid.text(rect.x + 2, rect.y + 1, fit(node.name, room), look === "off" ? COLOR.fadedMore : DEFAULT);
  const words = (node.description ?? "").split(/\s+/).filter(Boolean);
  let y = rect.y + 2;
  let line = "";
  for (const word of words) {
    if (y >= rect.y + rect.h - 1) break;
    if (line && line.length + 1 + word.length > room) {
      grid.text(rect.x + 2, y++, line, muted);
      line = "";
    }
    line = line ? `${line} ${word}` : fit(word, room);
  }
  if (line && y < rect.y + rect.h - 1) grid.text(rect.x + 2, y, line, muted);
}
function drawLegend(grid, scene) {
  const legend = scene.diagram.legend;
  if (!legend?.length) return;
  const panel = { x: 1, y: scene.legendRow, w: legendWidth(legend.map((e) => e.label)), h: legend.length + 2 };
  frame(grid, panel, COLOR.muted);
  grid.text(panel.x + 2, panel.y, " LEGEND ", COLOR.muted);
  legend.forEach((entry, i) => {
    const y = panel.y + 1 + i;
    const x = panel.x + 2;
    const color = entry.color ? hex(entry.color) : DEFAULT;
    if (entry.dash) grid.text(x, y, LINES[entry.dash].h.repeat(3), color);
    else if (entry.color) grid.text(x, y, "   ", color, Infinity, color);
    else grid.text(x, y, "\u2500\u2500\u2500", color);
    grid.text(x + 4, y, fit(entry.label, panel.w - 8), DEFAULT);
  });
}

// src/terminal/playback.ts
var TRAVEL_MS = 1500;
var STEP_MS = 2e3;
var FAIL_AT = 55;
function isErrorStep(step) {
  return !!step.failed || (step.statusCode ?? 0) >= 400;
}
function currentStepsOf(steps, index) {
  const group = steps[index]?.parallelGroup;
  return steps.filter((step, i) => i === index || i < index && group !== void 0 && step.parallelGroup === group);
}
function stepPath(scene, from, to) {
  const forward = scene.edges.find((e) => e.edge.source === from && e.edge.target === to);
  if (forward) return forward.path;
  const back = scene.edges.find((e) => e.edge.source === to && e.edge.target === from);
  if (back) return reverse(back.path);
  const a = scene.nodes.get(from);
  const b = scene.nodes.get(to);
  return a && b && a !== b ? fallbackPath(a.rect, b.rect) : void 0;
}
function reverse(path) {
  const cells = path.cells.slice().reverse();
  const first = path.cells[0];
  const intoBox = path.dirs[0] & ~(path.cells.length > 1 ? stepDir(first, path.cells[1]) : 0);
  const head = intoBox || (cells.length > 1 ? stepDir(cells[cells.length - 2], cells[cells.length - 1]) : path.head);
  const dirs = path.dirs.slice();
  if (path.cells.length > 1) dirs[dirs.length - 1] = stepDir(path.cells[path.cells.length - 1], path.cells[path.cells.length - 2]) | path.head;
  return { cells, dirs: dirs.reverse(), head };
}
function stepDir(a, b) {
  return b.x > a.x ? E : b.x < a.x ? W : b.y > a.y ? S : N;
}
var connects = (edge, step) => edge.source === step.fromServiceId && edge.target === step.toServiceId || edge.target === step.fromServiceId && edge.source === step.toServiceId;
function playAt(scene, steps, index, progress, tick = 0) {
  const current = currentStepsOf(steps, index);
  const active = /* @__PURE__ */ new Set();
  const failing = /* @__PURE__ */ new Set();
  for (const step of current) {
    active.add(step.fromServiceId);
    active.add(step.toServiceId);
    if (isErrorStep(step)) failing.add(step.toServiceId);
  }
  const pathNodes2 = new Set(steps.flatMap((s) => [s.fromServiceId, s.toServiceId]));
  const pathEdges = new Set(scene.edges.filter((e) => steps.some((s) => connects(e.edge, s))).map((e) => e.edge.id));
  const edges = [];
  const packets = [];
  for (const step of current) {
    const path = stepPath(scene, step.fromServiceId, step.toServiceId);
    if (!path) continue;
    const failed = !!step.failed;
    const error = isErrorStep(step);
    const roundTrip = step.executionType === "SYNC_REQUEST_RESPONSE" && !failed;
    edges.push({ path, error, failed, flowing: progress >= 100 && !failed });
    const share2 = failed ? Math.min(progress, FAIL_AT) / 100 : roundTrip ? progress <= 50 ? progress / 50 : 1 - (progress - 50) / 50 : progress / 100;
    const last = path.cells.length - 1;
    const at = path.cells[Math.max(0, Math.min(last, Math.round(share2 * last)))];
    if (failed && progress >= FAIL_AT) packets.push({ at, error: true, cut: true });
    else if (progress < 100) packets.push({ at, error: error && (!roundTrip || progress > 50), cut: false });
  }
  return { active, failing, pathNodes: pathNodes2, pathEdges, edges, packets, tick };
}

// ../frontend/src/playground/useCaseGroups.ts
function groupByEndpoint(useCases) {
  if (!useCases.some((u) => u.endpoint)) return [{ useCases }];
  const groups = /* @__PURE__ */ new Map();
  for (const u of useCases) {
    const label = u.endpointGroup ?? u.endpoint ?? "Other flows";
    groups.set(label, [...groups.get(label) ?? [], u]);
  }
  return [...groups].map(([label, list]) => ({ label, useCases: list }));
}

// ../plugin/src/register.tsx
var icons = "nerd-font";
var PANE = "proschi-view";
var PANE_VIEW = `${PANE}:0`;
var IDLE = { pick: "", step: 0, isPlaying: false, mode: "diagram", explorer: false, expanded: [] };
var NO_SOURCE = { source: "" };
var paneFile = atom({ plugin: "proschi", key: "paneFile" }, "");
var paneSource = atom({ plugin: "proschi", key: "paneSource" }, NO_SOURCE);
var players = atom({ plugin: "proschi", key: "player" }, IDLE);
var PANE_KEYS = "p play \xB7 n/b step \xB7 r restart \xB7 e end \xB7 x explorer \xB7 d diagram \xB7 esc back to the prompt";
var SYSTEM_KEYS = "s next system \xB7 o open/close \xB7 f focus in \xB7 u back out";
var FRAME2 = 50;
var HINT = [
  "Proschi diagrams render in this terminal: put a Proschi document in a ```proschi fenced block",
  "(or write a .proschi file) and Claude Code draws it as the architecture, with a player for its",
  "use cases and the simulation's load on each node when it has `traffic`. Use the block instead of",
  "Mermaid or ASCII art when showing an architecture or a request flow."
].join(" ");
var layouts = /* @__PURE__ */ new Map();
var pending = /* @__PURE__ */ new Set();
var documents = /* @__PURE__ */ new Map();
var scenes = /* @__PURE__ */ new Map();
var timers = /* @__PURE__ */ new Map();
var FENCE = /^```proschi[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm;
function register(on, options) {
  const chosen = options.icons;
  icons = chosen === "symbols" || chosen === "none" ? chosen : "nerd-font";
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "proschi", description: "Proschi diagrams: /proschi view <file.proschi> shows one in a pane", argumentHint: "view [--expand <id>,\u2026] [--focus <id>] <file>" });
    return next(e);
  });
  on("prompt.compose", async ($, e, next) => {
    const composed = await next(e);
    return { ...composed, sections: [...composed.sections, { id: "proschi:render", text: HINT, scope: "session" }] };
  });
  on("command.run", { command: "proschi" }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/);
    const words = [];
    const view = {};
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--expand" || rest[i] === "--focus") {
        const value = rest[++i];
        if (!value || idList(value).length === 0) return { text: `Missing system id after ${rest[i - 1]}` };
        if (rest[i - 1] === "--expand") view.expanded = [...view.expanded ?? [], ...idList(value)];
        else view.focus = value;
      } else words.push(rest[i]);
    }
    const file = words.join(" ");
    if (verb !== "view" || !file) return { text: USAGE };
    if (!await $.fs.exists(file)) return { text: `No such file: ${file}` };
    if (view.expanded || view.focus !== void 0) {
      const { diagram, errors } = parseSource(await readWithImports($, file));
      const refused = errors.length ? void 0 : viewError(diagram, view);
      if (refused) return { text: refused };
    }
    stop(PANE_VIEW);
    await update($, memberOf(players, { requestId: PANE_VIEW }), () => ({ ...IDLE, expanded: view.expanded ?? [], ...view.focus !== void 0 ? { focus: view.focus } : {} }));
    await update($, paneFile, () => file);
    await $.ui.open({ id: PANE, title: `Proschi \xB7 ${basename(file)}` });
    watch($, file);
    return { text: `Showing ${file} in the Proschi pane.` };
  });
  on("ui.close", { id: PANE }, async ($, e, next) => {
    stop(PANE_VIEW);
    stop(PANE);
    return next(e);
  });
  on("ui.render", { component: "AssistantMessage" }, async ($, e, next) => {
    if (e.surface !== "terminal" || !e.props.text.includes("```proschi")) return next(e);
    const ui = $.ui.resolve(e);
    const parts = [];
    let last = 0;
    let n = 0;
    for (const match of e.props.text.matchAll(FENCE)) {
      const before2 = e.props.text.slice(last, match.index);
      if (before2.trim()) parts.push(/* @__PURE__ */ h(ui.Markdown, { text: before2 }));
      const view = await diagramView($, { ui, requestId: e.requestId, columns: (e.viewport?.columns ?? 120) - 4 }, `${e.requestId}:${n++}`, { source: match[1] });
      if ("error" in view) {
        parts.push(/* @__PURE__ */ h(ui.Markdown, { text: match[0] }));
        parts.push(/* @__PURE__ */ h(ui.Text, { dimColor: true }, view.error));
      } else parts.push(view.element);
      last = match.index + match[0].length;
    }
    if (n === 0) return next(e);
    const after2 = e.props.text.slice(last);
    if (after2.trim()) parts.push(/* @__PURE__ */ h(ui.Markdown, { text: after2 }));
    return /* @__PURE__ */ h(ui.Box, { flexDirection: "column" }, parts);
  });
  on("ui.render", { component: "ToolUse" }, async ($, e, next) => {
    const file = proschiFile(e.props.tool, e.props.input);
    if (e.surface !== "terminal" || !file || e.props.isRunning || e.props.isErrored) return next(e);
    const row = await next(e);
    const ui = $.ui.resolve(e);
    const source = await readWithImports($, file).catch(() => void 0);
    if (!source) return row;
    const view = await diagramView($, { ui, requestId: e.requestId, columns: (e.viewport?.columns ?? 120) - 6 }, `${e.requestId}:0`, source, file);
    return /* @__PURE__ */ h(ui.Box, { flexDirection: "column" }, row, /* @__PURE__ */ h(ui.Box, { paddingLeft: 2 }, "error" in view ? /* @__PURE__ */ h(ui.Text, { dimColor: true }, view.error) : view.element));
  });
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    if (e.surface !== "terminal") {
      const { Text } = $.ui.resolve(e);
      return /* @__PURE__ */ h(Text, null, "The Proschi pane draws in a terminal.");
    }
    const ui = $.ui.resolve(e);
    const file = await read($, paneFile);
    const focused = file ? NO_SOURCE : await read($, paneSource);
    if (!file && !focused.source) return /* @__PURE__ */ h(ui.Text, { dimColor: true }, "Run /proschi view <file.proschi>.");
    const source = file ? await readWithImports($, file).catch(() => void 0) : focused;
    if (!source) return /* @__PURE__ */ h(ui.Text, { color: "red" }, "Cannot read ", file, ".");
    const columns = "bodyColumns" in e.props && typeof e.props.bodyColumns === "number" ? e.props.bodyColumns : (e.viewport?.columns ?? 120) - 4;
    const view = await diagramView($, { ui, requestId: PANE, columns }, PANE_VIEW, source);
    if ("error" in view) return /* @__PURE__ */ h(ui.Text, { color: "red" }, view.error);
    const isFocused = "isFocused" in e.props && e.props.isFocused === true;
    return /* @__PURE__ */ h(ui.Box, { flexDirection: "column" }, view.element, /* @__PURE__ */ h(ui.Text, { dimColor: true, wrap: "truncate-end" }, isFocused ? PANE_KEYS : "ctrl+x tab focuses the pane for its keys"), isFocused && view.systems && /* @__PURE__ */ h(ui.Text, { dimColor: true, wrap: "truncate-end" }, SYSTEM_KEYS));
  });
}
function proschiFile(tool, input) {
  if (tool !== "Write" && tool !== "Edit") return void 0;
  const path = input?.file_path;
  return typeof path === "string" && path.endsWith(".proschi") ? path : void 0;
}
var USAGE = "Usage: /proschi view [--expand <system>[,<system>\u2026]] [--focus <system>] <file.proschi>";
var basename = (path) => path.split("/").pop() ?? path;
var dirname = (path) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
async function projectRoot($, dir) {
  for (let current = dir; ; current = dirname(current)) {
    if (await $.fs.exists(`${current}/proschi.json`) || await $.fs.exists(`${current}/.git`)) return current || "/";
    if (!current || current === "/") return dir;
  }
}
var importReasons = /* @__PURE__ */ new Map();
async function readWithImports($, file) {
  const name = basename(file);
  const dir = dirname(file);
  const root = await projectRoot($, dir);
  const doc = { source: await $.fs.read(file), path: name, imports: {} };
  const lock = {};
  for (let round2 = 0; round2 < 8; round2++) {
    const missing = missingImports(doc).filter((key) => key !== name && !(key in doc.imports));
    if (missing.length === 0) break;
    for (const key of missing) {
      importReasons.delete(key);
      if (isRemoteSpec(key)) {
        doc.imports[key] = await readRemote($, root, key, lock.read ??= readLock($, root)).catch((error) => {
          importReasons.set(key, error instanceof Error ? error.message : String(error));
          return "";
        });
        continue;
      }
      const path = importFilePath(dir, root, key);
      doc.imports[key] = path && await $.fs.exists(path) ? await $.fs.read(path) : "";
    }
  }
  return doc;
}
async function readLock($, root) {
  const file = `${root}/${LOCK_FILE}`;
  return await $.fs.exists(file) ? parseLock(await $.fs.read(file)) : void 0;
}
async function readRemote($, root, spec, locked) {
  const lock = await locked;
  if (!lock) throw remoteError.noLock(spec);
  const hash = lockedHash(lock, spec);
  if (!hash) throw remoteError.notLocked(spec);
  const file = `${root}/${CACHE_DIR}/${hash}`;
  if (!await $.fs.exists(file)) throw remoteError.notCached(spec);
  const { base64: base642 } = await $.fs.read(file, { as: "bytes" });
  const bytes = Uint8Array.from(atob(base642), (c) => c.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  if ([...digest].map((b) => b.toString(16).padStart(2, "0")).join("") !== hash) throw remoteError.altered(spec);
  return new TextDecoder().decode(bytes);
}
function watch($, file) {
  stop(PANE);
  let seen = 0;
  timers.set(
    PANE,
    $.clock.every(1e3, async () => {
      if (await read($, paneFile) !== file) return;
      const stat = await $.fs.stat(file).catch(() => void 0);
      const mtime = stat && "mtimeMs" in stat ? Number(stat.mtimeMs) : 0;
      if (seen && mtime !== seen) $.ui.invalidate("ui.render");
      seen = mtime;
    })
  );
}
function requestLayout($, key, source) {
  if (pending.has(key)) return;
  pending.add(key);
  void $.process.run(["node", `${$.plugin.root}/hooks/layout.cjs`], { stdin: JSON.stringify(source), timeoutMs: 3e4 }).then(
    ({ exitCode, stdout, stderr }) => {
      layouts.set(key, exitCode === 0 ? JSON.parse(stdout) : { error: stderr.trim() || `layout exited with ${exitCode}` });
    },
    (error) => {
      layouts.set(key, { error: `Proschi lays diagrams out with Node.js 18 or newer, which did not start: ${String(error)}` });
    }
  ).finally(() => {
    pending.delete(key);
    $.ui.invalidate("ui.render");
  });
}
var pickOf = (useCase, scenario) => ({ value: `${useCase.id}:${scenario.id}`, useCase, scenario });
function normal(p) {
  return {
    pick: p?.pick ?? "",
    step: typeof p?.step === "number" ? p.step : 0,
    isPlaying: p?.isPlaying === true && p.mode === "play",
    mode: p?.mode === "play" ? "play" : "diagram",
    explorer: p?.explorer === true,
    expanded: Array.isArray(p?.expanded) ? p.expanded.filter((id) => typeof id === "string") : [],
    ...typeof p?.focus === "string" ? { focus: p.focus } : {},
    ...typeof p?.selected === "string" ? { selected: p.selected } : {}
  };
}
var PINK = "#ff5da2";
var INK = "#111111";
var YELLOW = "#ffd23f";
var PAUSE = "\u275A\u275A Pause";
var PLAY = " \u25B6 Play ";
var BARS_WIDTH = 80;
async function diagramView($, d, viewId, written, file) {
  const { ui } = d;
  const player = normal(await read($, memberOf(players, { requestId: viewId })));
  const shown = { ...player.expanded.length ? { expanded: player.expanded } : {}, ...player.focus !== void 0 ? { focus: player.focus } : {} };
  const source = shown.expanded || shown.focus !== void 0 ? { ...written, view: shown } : written;
  const key = keyOf(source);
  let doc = documents.get(key);
  if (!doc) {
    doc = loadDocument(source);
    documents.set(key, doc);
  }
  const where2 = file ?? "The diagram";
  if (doc.errors.length > 0) {
    const [first] = doc.errors;
    return { error: `${where2} has errors (line ${first.line}: ${first.message})${file ? `: run \`npx proschi check ${file}\`` : ""}.` };
  }
  if (doc.diagram.nodes.length === 0) return { error: `${where2} has no components to draw.` };
  const layout = layouts.get(key);
  if (!layout) {
    requestLayout($, key, source);
    return { element: /* @__PURE__ */ h(ui.Text, { dimColor: true }, "Laying out ", doc.diagram.title ?? "the diagram", "\u2026"), systems: false };
  }
  if ("error" in layout) return { error: `Proschi could not lay ${file ?? "this diagram"} out: ${layout.error}` };
  const columns = Math.max(40, Math.min(512, d.columns));
  const sceneKey = `${key}@${columns}`;
  let scene = scenes.get(sceneKey);
  if (!scene) {
    scene = buildScene(doc.diagram, layout, columns);
    scenes.set(sceneKey, scene);
  }
  const picks = doc.diagram.useCases.flatMap((u) => u.scenarios.map((s) => pickOf(u, s)));
  const pick2 = picks.find((p) => p.value === player.pick) ?? picks[0];
  const playing = player.mode === "play" ? pick2 : void 0;
  const steps = playing?.scenario.steps ?? [];
  const step = Math.max(0, Math.min(player.step, steps.length - 1));
  const width = Math.min(Math.max(40, d.columns), Math.max(scene.columns, BARS_WIDTH));
  const systems = selectable(scene, player.focus);
  const selected = systems.find((s) => s.path === player.selected) ?? systems[0];
  const view = { d, viewId, rasterKey: `d-${viewId}`, anchorKey: `at-${viewId}`, scene, width, overlay: doc.overlay, systems: doc.systems, ...selected ? { selected: selected.id } : {}, inPane: d.requestId === PANE };
  if (playing && player.isPlaying && !timers.has(viewId)) animate($, view, steps);
  const progress = timers.has(viewId) ? 0 : 100;
  const grid = paint(scene, { overlay: doc.overlay, icons, systems: doc.systems, ...view.selected ? { selected: view.selected } : {}, ...steps.length > 0 ? { play: playAt(scene, steps, step, progress) } : {} });
  const link = doc.link(playing ? { useCase: playing.useCase.id, ...playing.useCase.scenarios.length > 1 ? { scenario: playing.scenario.id } : {}, step } : void 0);
  const lost = lostImports(written, keyOf(written));
  const hasSystems = systems.length > 0 || player.focus !== void 0;
  const roomy = view.width >= 79;
  return { element: /* @__PURE__ */ h(ui.Box, { flexDirection: "column" }, playing ? playerHeader($, view, playing, player) : doc.diagram.title && /* @__PURE__ */ h(ui.Box, { flexDirection: "column" }, /* @__PURE__ */ h(ui.Text, { bold: true }, doc.diagram.title), doc.diagram.summary && /* @__PURE__ */ h(ui.Text, { dimColor: true }, doc.diagram.summary)), /* @__PURE__ */ h(ui.Box, { key: view.anchorKey, flexDirection: "column" }, grid.columns > d.columns && /* @__PURE__ */ h(ui.Text, { dimColor: true, wrap: "truncate-end" }, "\u2194 ", grid.columns, " columns wide, wider than the ", d.columns, " here: ", view.inPane ? "widen the window" : "use \u26F6 Focus or a wider window", " to see it whole."), lost.some((name) => !importReasons.has(name)) && /* @__PURE__ */ h(ui.Text, { dimColor: true, wrap: "truncate-end" }, "\u26A0 Not found, so drawn as plain boxes: ", lost.filter((name) => !importReasons.has(name)).join(", ")), lost.filter((name) => importReasons.has(name)).map((name) => /* @__PURE__ */ h(ui.Text, { key: `lost-${name}`, dimColor: true }, "\u26A0 ", importReasons.get(name))), doc.notes.map((note) => /* @__PURE__ */ h(ui.Text, { color: "yellow" }, "\u26A0 ", note.text, note.hint && /* @__PURE__ */ h(ui.Text, { dimColor: true }, " \u2192 ", note.hint))), /* @__PURE__ */ h(ui.Raster, { key: view.rasterKey, columns: grid.columns, rows: grid.rows, cells: grid.toBase64() })), hasSystems && !playing && systemBar($, view, doc, systems, selected, player), playing ? stepPanel($, view, playing, step, player) : pick2 && useCaseBar($, view, doc, pick2, player), /* @__PURE__ */ h(ui.Box, { flexDirection: "row", gap: 1, borderStyle: "round", borderColor: "gray", paddingX: 1, width: view.width }, /* @__PURE__ */ h(ui.Button, { key: `src-${viewId}`, label: roomy ? "\u29C9 Copy source" : "\u29C9 Source", onPress: (press) => void copy($, press.surface, source.source, "the Proschi source") }), /* @__PURE__ */ h(ui.Button, { key: `lnk-${viewId}`, label: roomy ? "\u29C9 Copy share link" : "\u29C9 Link", onPress: (press) => void copy($, press.surface, link, "the share link") }), /* @__PURE__ */ h(ui.Button, { key: `open-${viewId}`, label: roomy ? "\u2197 Open in Proschi" : "\u2197 Open", variant: "primary", onPress: (press) => void openLink($, press.surface, link) }), !view.inPane && /* @__PURE__ */ h(ui.Button, { key: `focus-${viewId}`, label: "\u26F6 Focus", onPress: () => focus($, view, file ? basename(file) : doc.diagram.title ?? "diagram", file ? { file } : { source }) }))), systems: hasSystems };
}
function selectable(scene, focus2) {
  return [...scene.nodes.values()].map((n) => n.node).filter((n) => n.kind === "system" || n.kind === "group" && n.system === n.id).map((n) => ({ id: n.id, path: focus2 !== void 0 ? `${focus2}.${n.id}` : n.id, name: n.name, expanded: n.kind === "group" }));
}
function systemBar($, view, doc, systems, selected, player) {
  const { ui } = view.d;
  const design = selected !== void 0 && !!systemAt2(doc.root, selected.path)?.diagram;
  const next = () => {
    const at = systems.findIndex((s) => s.path === selected?.path);
    const to = systems[(at + 1) % systems.length];
    if (to) void setPlayer($, view, (p) => ({ ...p, selected: to.path }));
  };
  const toggle2 = () => {
    if (!selected || !design) return;
    const open2 = player.expanded.includes(selected.path) || selected.expanded;
    void setPlayer($, view, (p) => ({
      ...p,
      // Closing a system closes the ones inside it too.
      expanded: open2 ? p.expanded.filter((id) => id !== selected.path && !id.startsWith(`${selected.path}.`)) : [...p.expanded, selected.path],
      selected: selected.path
    }));
  };
  const enter = () => {
    if (!selected || !design) return;
    void setPlayer($, view, (p) => ({ ...p, focus: selected.path, selected: void 0, pick: "", mode: "diagram", isPlaying: false }));
  };
  const leave = () => {
    const focus2 = player.focus;
    if (focus2 === void 0) return;
    const up = focus2.includes(".") ? focus2.slice(0, focus2.lastIndexOf(".")) : void 0;
    void setPlayer($, view, (p) => {
      const { focus: _focus, ...rest } = p;
      void _focus;
      return { ...rest, ...up !== void 0 ? { focus: up } : {}, selected: focus2, pick: "", mode: "diagram", isPlaying: false };
    });
  };
  const open = selected !== void 0 && (selected.expanded || player.expanded.includes(selected.path));
  return /* @__PURE__ */ h(ui.Box, { flexDirection: "column", borderStyle: "round", borderColor: "gray", paddingX: 1, width: view.width }, player.focus !== void 0 && /* @__PURE__ */ h(ui.Text, { dimColor: true, wrap: "truncate-end" }, "Inside ", player.focus.split(".").join(" \u203A "), " \xB7 ", doc.diagram.title ?? "its design"), /* @__PURE__ */ h(ui.Box, { flexDirection: "row", gap: 1, alignItems: "center", flexWrap: "wrap" }, /* @__PURE__ */ h(ui.Text, { bold: true }, "System"), /* @__PURE__ */ h(ui.Text, { color: PINK, wrap: "truncate-end" }, selected ? `${selected.name} (${selected.path})` : "none here"), systems.length > 1 && /* @__PURE__ */ h(ui.Button, { key: `sys-next-${view.viewId}`, label: "\u21E5 Next", ...hotkey(view, "s"), onPress: next }), selected && design && /* @__PURE__ */ h(ui.Button, { key: `sys-open-${view.viewId}`, label: open ? "\u229F Collapse" : "\u229E Expand", ...hotkey(view, "o"), onPress: toggle2 }), selected && design && /* @__PURE__ */ h(ui.Button, { key: `sys-focus-${view.viewId}`, label: "\u2922 Focus in", ...hotkey(view, "f"), onPress: enter }), player.focus !== void 0 && /* @__PURE__ */ h(ui.Button, { key: `sys-back-${view.viewId}`, label: "\u2191 Back out", ...hotkey(view, "u"), onPress: leave })));
}
var lostByKey = /* @__PURE__ */ new Map();
function lostImports(source, key) {
  let names = lostByKey.get(key);
  if (!names) {
    const empty = Object.entries(source.imports ?? {}).filter(([, text]) => text === "").map(([name]) => name);
    names = [.../* @__PURE__ */ new Set([...missingImports(source), ...empty])];
    lostByKey.set(key, names);
  }
  return names;
}
var EXPLORE = { long: ["\u2261 Explore use cases", "\u2261 Hide explorer"], short: ["\u2261 Explore", "\u2261 Hide"] };
var toggle = (labels, open) => labels[open ? 1 : 0].padEnd(Math.max(...labels.map((l) => l.length)));
var cut = (text, room) => text.length <= room ? text : `${text.slice(0, Math.max(0, room - 1))}\u2026`;
function useCaseBar($, view, doc, pick2, player) {
  const { ui } = view.d;
  const groups = groupByEndpoint(doc.diagram.useCases);
  const count = (u) => `${u.scenarios.length} scenario${u.scenarios.length === 1 ? "" : "s"}`;
  const labels = groups.flatMap((g) => g.useCases.map((u) => ({ value: u.id, label: `${g.label ? `${g.label} \u203A ` : ""}${u.name} \xB7 ${count(u)}` })));
  const inner = view.width - 4;
  const longToggle = toggle(EXPLORE.long, false).length + 4;
  const picker = 9 + Math.max(...labels.map((o) => o.label.length)) + 2;
  const oneRow = picker + 1 + 10 + 1 + longToggle <= inner;
  const explore = toggle(10 + 1 + longToggle <= inner ? EXPLORE.long : EXPLORE.short, player.explorer);
  const options = oneRow ? labels : labels.map((o) => ({ ...o, label: cut(o.label, inner - 9 - 2) }));
  const select = /* @__PURE__ */ h(ui.Box, { flexDirection: "row", gap: 1, alignItems: "center" }, /* @__PURE__ */ h(ui.Text, { bold: true, color: PINK }, "Use case"), /* @__PURE__ */ h(
    ui.Select,
    {
      key: `uc-${view.viewId}`,
      value: pick2.useCase.id,
      options,
      onSelect: (id) => {
        const u = doc.diagram.useCases.find((c) => c.id === id);
        if (u?.scenarios[0]) void setPlayer($, view, (p) => ({ ...p, pick: pickOf(u, u.scenarios[0]).value }));
      }
    }
  ));
  const buttons = /* @__PURE__ */ h(ui.Box, { flexDirection: "row", gap: 1, alignItems: "center" }, /* @__PURE__ */ h(ui.Button, { key: `play-${view.viewId}`, label: "\u25B6 Play", variant: "primary", ...hotkey(view, "p"), onPress: () => start($, view, pick2) }), /* @__PURE__ */ h(ui.Button, { key: `explore-${view.viewId}`, label: explore, ...hotkey(view, "x"), onPress: () => void setPlayer($, view, (p) => ({ ...p, explorer: !p.explorer })) }));
  return /* @__PURE__ */ h(ui.Box, { flexDirection: "column", borderStyle: "round", borderColor: PINK, paddingX: 1, width: view.width }, /* @__PURE__ */ h(ui.Box, { flexDirection: oneRow ? "row" : "column", gap: oneRow ? 1 : 0 }, select, buttons), player.explorer && groups.map((g) => /* @__PURE__ */ h(ui.Box, { flexDirection: "column", marginTop: 1 }, g.label && /* @__PURE__ */ h(ui.Text, { bold: true, color: "cyan" }, g.label), g.useCases.map((u) => /* @__PURE__ */ h(ui.Box, { flexDirection: "row", gap: 1, flexWrap: "wrap", paddingLeft: g.label ? 2 : 0 }, /* @__PURE__ */ h(ui.Text, { bold: u.id === pick2.useCase.id }, u.name), u.scenarios.map((s) => /* @__PURE__ */ h(ui.Button, { key: `x-${view.viewId}-${u.id}-${s.id}`, onPress: () => start($, view, pickOf(u, s)) }, scenarioLabel(ui, u, s))))))));
}
function scenarioLabel(ui, u, s, current) {
  const error = s.outcome === "error";
  const status = error ? s.steps.find(isErrorStep)?.statusCode : void 0;
  const name = u.scenarios.length > 1 ? s.name : "Play";
  return /* @__PURE__ */ h(ui.Text, { color: error ? "red" : "green", bold: current === true }, current === void 0 ? "" : current ? "\u25B8 " : "  ", error ? "\u2717" : "\u2713", " ", name, status ? ` \xB7 ${status}` : "");
}
function playerHeader($, view, pick2, player) {
  const { ui } = view.d;
  const { useCase } = pick2;
  return /* @__PURE__ */ h(ui.Box, { flexDirection: "column", borderStyle: "round", borderColor: PINK, paddingX: 1, width: view.width }, /* @__PURE__ */ h(ui.Box, { flexDirection: "row", gap: 1, alignItems: "center" }, /* @__PURE__ */ h(ui.Button, { key: `back-${view.viewId}`, label: "\u2190 Diagram", ...hotkey(view, "d"), onPress: () => void setPlayer($, view, (p) => ({ ...p, mode: "diagram", isPlaying: false })) }), /* @__PURE__ */ h(ui.Text, { bold: true, wrap: "truncate-end" }, useCase.name), /* @__PURE__ */ h(ui.Text, { dimColor: true, wrap: "truncate-end" }, "\xB7 Playback mode \xB7 read only")), useCase.scenarios.length > 1 && /* @__PURE__ */ h(ui.Box, { flexDirection: "row", gap: 1, flexWrap: "wrap" }, useCase.scenarios.map((s) => {
    const current = s.id === pick2.scenario.id;
    return /* @__PURE__ */ h(ui.Button, { key: `sc-${view.viewId}-${s.id}`, variant: current ? "primary" : void 0, dimColor: !current, onPress: () => start($, view, pickOf(useCase, s), player.isPlaying) }, scenarioLabel(ui, useCase, s, current));
  })));
}
var FORMAT = { JSON: "JSON", XML: "XML", FREE_TEXT: "Text" };
var LANGUAGE = { JSON: "json", XML: "xml", FREE_TEXT: void 0 };
var chip = (ui, text, background) => /* @__PURE__ */ h(ui.Text, { backgroundColor: background, color: INK, bold: true }, ` ${text} `);
var BODY_LINES = 8;
function bodyRows(ui, label, text, format) {
  const lines = text.replace(/\n+$/, "").split("\n");
  const shown = lines.slice(0, BODY_LINES);
  const more = lines.length - shown.length;
  const language = LANGUAGE[format];
  return {
    nodes: [
      label,
      /* @__PURE__ */ h(ui.Code, { source: shown.join("\n"), wrap: "truncate-end", ...language ? { language } : {} }),
      ...more > 0 ? [/* @__PURE__ */ h(ui.Text, { dimColor: true }, "\u2026 ", more, " more line", more === 1 ? "" : "s")] : []
    ],
    height: 1 + shown.length + (more > 0 ? 1 : 0)
  };
}
function stepRows(ui, view, steps, at) {
  const name = (id) => view.scene.nodes.get(id)?.node.name ?? id;
  const current = currentStepsOf(steps, at);
  const nodes = [];
  let height = 0;
  const row = (node) => {
    nodes.push(node);
    height++;
  };
  const add = (rows) => {
    nodes.push(...rows.nodes);
    height += rows.height;
  };
  if (current.length > 1) {
    row(
      /* @__PURE__ */ h(ui.Text, { bold: true, color: "blue", wrap: "truncate-end" }, "\u26A1 Parallel Execution (", current.length, " steps running simultaneously)")
    );
  }
  if (steps.length === 0) row(/* @__PURE__ */ h(ui.Text, { dimColor: true }, "This scenario has no steps."));
  current.forEach((s, i) => {
    const error = isErrorStep(s);
    const call = `${s.httpMethod} ${s.endpoint}`.trim();
    if (i > 0) row(/* @__PURE__ */ h(ui.Text, null, " "));
    row(
      /* @__PURE__ */ h(ui.Text, { wrap: "truncate-end" }, chip(ui, String(steps.indexOf(s) + 1), error ? "#ff3b30" : PINK), " ", /* @__PURE__ */ h(ui.Text, { bold: true }, s.stepName), s.failed && /* @__PURE__ */ h(ui.Text, null, " ", chip(ui, "Failed", "#fca5a5")), !s.failed && (s.statusCode ?? 0) >= 400 && /* @__PURE__ */ h(ui.Text, null, " ", chip(ui, String(s.statusCode), "#fca5a5")), s.executionType === "SYNC_REQUEST_RESPONSE" && /* @__PURE__ */ h(ui.Text, null, " ", chip(ui, "Sync", "#86efac")), s.executionType === "ASYNC_FIRE_AND_FORGET" && /* @__PURE__ */ h(ui.Text, null, " ", chip(ui, "Fire & Forget", "#fdba74")), s.executionType === "ASYNC_REQUEST_RESPONSE" && /* @__PURE__ */ h(ui.Text, null, " ", chip(ui, "Async", "#d8b4fe")))
    );
    row(
      /* @__PURE__ */ h(ui.Text, { dimColor: true, wrap: "truncate-end" }, name(s.fromServiceId), " \u2192 ", name(s.toServiceId), call && call !== s.stepName ? `   ${call}` : "")
    );
    if (s.description) row(/* @__PURE__ */ h(ui.Text, { wrap: "truncate-end" }, s.description.replace(/\s*\n\s*/g, " ")));
    if (s.requestBody) add(bodyRows(ui, /* @__PURE__ */ h(ui.Text, { dimColor: true }, "Request (", FORMAT[s.requestFormat], ")"), s.requestBody, s.requestFormat));
    if (s.responseBody && s.executionType !== "ASYNC_FIRE_AND_FORGET") {
      const label = /* @__PURE__ */ h(ui.Text, { color: error ? "red" : void 0, dimColor: !error }, "Response (", FORMAT[s.responseFormat], ")", s.statusCode !== void 0 ? ` - ${s.statusCode}` : "");
      add(bodyRows(ui, label, s.responseBody, s.responseFormat));
    }
    if (!s.responseBody && !s.failed && (s.statusCode ?? 0) >= 400) row(/* @__PURE__ */ h(ui.Text, { color: "red" }, "Answered with ", s.statusCode));
    if (s.failed) {
      row(
        /* @__PURE__ */ h(ui.Text, { color: "red", wrap: "truncate-end" }, "No response: the call failed (timeout, connection refused or similar).")
      );
    }
  });
  return { nodes, height };
}
function stepPanel($, view, pick2, step, player) {
  const { ui } = view.d;
  const { scenario } = pick2;
  const steps = scenario.steps;
  const total = steps.length;
  const go = (to, isPlaying = false) => {
    reveal($, view);
    void setPlayer($, view, (p) => ({ ...p, step: Math.max(0, Math.min(total - 1, to)), isPlaying }), steps);
  };
  const rows = stepRows(ui, view, steps, step);
  const tallest = steps.reduce((most, _, i) => Math.max(most, stepRows(ui, view, steps, i).height), rows.height);
  const counter = `Step ${String(Math.min(step + 1, total)).padStart(String(total).length)} of ${total}`;
  const room = view.width - 4 - (5 + 5 + 12 + 5 + 5 + counter.length + 7);
  const exit = room - 19 >= 10 ? "\u2715 Exit playback" : "\u2715 Exit";
  const left = room - (exit.length + 4);
  const bar = left >= 6 ? Math.min(60, left) : 0;
  const filled = total === 0 ? 0 : Math.round(bar * (step + 1) / total);
  return /* @__PURE__ */ h(ui.Box, { flexDirection: "column", borderStyle: "round", borderColor: "gray", paddingX: 1, width: view.width }, scenario.condition && /* @__PURE__ */ h(ui.Text, { wrap: "truncate-end" }, /* @__PURE__ */ h(ui.Text, { bold: true }, "When:"), " ", scenario.condition), /* @__PURE__ */ h(ui.Box, { key: `rows-${view.viewId}`, flexDirection: "column" }, rows.nodes, Array.from({ length: tallest - rows.height }, () => /* @__PURE__ */ h(ui.Text, null, " "))), /* @__PURE__ */ h(ui.Box, { flexDirection: "row", gap: 1, alignItems: "center", marginTop: 1, flexWrap: "wrap" }, /* @__PURE__ */ h(ui.Button, { key: `reset-${view.viewId}`, label: "\u21E4", ...hotkey(view, "r"), onPress: () => go(0) }), /* @__PURE__ */ h(ui.Button, { key: `prev-${view.viewId}`, label: "\u2039", ...hotkey(view, "b"), onPress: () => go(step - 1) }), /* @__PURE__ */ h(
    ui.Button,
    {
      key: `play-${view.viewId}`,
      label: player.isPlaying ? PAUSE : PLAY,
      variant: "primary",
      ...hotkey(view, "p"),
      onPress: () => player.isPlaying ? void setPlayer($, view, (p) => ({ ...p, isPlaying: false })) : go(step >= total - 1 ? 0 : step, true)
    }
  ), /* @__PURE__ */ h(ui.Button, { key: `next-${view.viewId}`, label: "\u203A", ...hotkey(view, "n"), onPress: () => go(step + 1) }), /* @__PURE__ */ h(ui.Button, { key: `end-${view.viewId}`, label: "\u21E5", ...hotkey(view, "e"), onPress: () => go(total - 1) }), /* @__PURE__ */ h(ui.Text, null, counter), bar > 0 && /* @__PURE__ */ h(ui.Text, null, /* @__PURE__ */ h(ui.Text, { color: YELLOW }, "\u2501".repeat(filled)), /* @__PURE__ */ h(ui.Text, { dimColor: true }, "\u2501".repeat(bar - filled))), /* @__PURE__ */ h(ui.Button, { key: `exit-${view.viewId}`, label: exit, dimColor: true, onPress: () => void setPlayer($, view, (p) => ({ ...p, mode: "diagram", isPlaying: false })) })));
}
var hotkey = (view, key) => view.inPane ? { hotkey: key } : {};
function start($, view, pick2, isPlaying = true) {
  reveal($, view);
  void setPlayer($, view, (p) => ({ ...p, pick: pick2.value, step: 0, isPlaying, mode: "play" }), pick2.scenario.steps);
}
function reveal($, view) {
  void scroll($, view.inPane ? { to: { key: view.anchorKey }, in: PANE, block: "start" } : { to: { requestId: view.d.requestId }, block: "start" });
}
async function scroll($, args) {
  const moved = await $.ui.scroll(args).catch((error) => ({ deny: String(error) }));
  if (moved.deny) $.ui.log(`proschi: scroll to ${JSON.stringify(args.to)} refused: ${moved.deny}`, { to: "debug" });
  return moved;
}
function focus($, view, title, what) {
  const opened = $.ui.open({ id: PANE, title: `Proschi \xB7 ${title}`, focus: true, closeOnEscape: true });
  void (async () => {
    const player = normal(await read($, memberOf(players, { requestId: view.viewId })));
    if (player.isPlaying) await setPlayer($, view, (p) => ({ ...p, isPlaying: false }));
    stop(PANE_VIEW);
    await update($, memberOf(players, { requestId: PANE_VIEW }), () => player);
    if ("file" in what) {
      await update($, paneFile, () => what.file);
      watch($, what.file);
    } else {
      const { source, path, imports } = what.source;
      stop(PANE);
      await update($, paneFile, () => "");
      await update($, paneSource, () => ({ source, ...path ? { path } : {}, ...imports ? { imports } : {} }));
    }
    const placed = await opened;
    if (!placed.isPlaced) $.ui.toast(`The Proschi pane is open but not shown: ${placed.reason}`);
  })();
}
async function setPlayer($, view, fn, steps) {
  stop(view.viewId);
  if (steps && steps.length > 0) animate($, view, steps);
  await update($, memberOf(players, { requestId: view.viewId }), (p) => fn(normal(p)));
}
function stop(viewId) {
  timers.get(viewId)?.cancel();
  timers.delete(viewId);
}
function animate($, view, steps) {
  stop(view.viewId);
  let started = -1;
  let tick = 0;
  const timer = $.clock.every(FRAME2, async () => {
    const player = normal(await read($, memberOf(players, { requestId: view.viewId })));
    if (player.mode !== "play") return stop(view.viewId);
    const step = Math.max(0, Math.min(player.step, steps.length - 1));
    const now = await $.clock.now();
    if (started < 0) started = now;
    const elapsed = now - started;
    const play = playAt(view.scene, steps, step, Math.min(100, elapsed / TRAVEL_MS * 100), tick++);
    await $.ui.blit({ requestId: view.d.requestId, key: view.rasterKey, cells: paint(view.scene, { overlay: view.overlay, icons, systems: view.systems, ...view.selected ? { selected: view.selected } : {}, play }).toBase64() });
    if (!player.isPlaying) {
      if (elapsed >= TRAVEL_MS) stop(view.viewId);
      return;
    }
    if (elapsed < STEP_MS) return;
    started = -1;
    const last = step >= steps.length - 1;
    if (last) stop(view.viewId);
    await update($, memberOf(players, { requestId: view.viewId }), (p) => ({ ...normal(p), step: last ? step : step + 1, isPlaying: !last }));
    if (view.inPane) await scroll($, { to: { key: view.anchorKey }, in: PANE, block: "nearest" });
  });
  timers.set(view.viewId, timer);
}
async function copy($, surface, text, what) {
  const copied = await $.ui.copy({ text, surface });
  $.ui.toast(copied.isCopied ? `Copied ${what} to the clipboard` : `Could not copy ${what}: ${copied.reason === "no-clipboard" ? "no clipboard tool answered" : copied.reason}`);
}
async function openLink($, surface, link) {
  for (const opener of ["open", "xdg-open"]) {
    const opened = await $.process.run([opener, link], { timeoutMs: 1e4 }).then(
      (r) => r.exitCode === 0,
      () => false
    );
    if (opened) {
      $.ui.toast("Opened the diagram in Proschi");
      return;
    }
  }
  await copy($, surface, link, "the Proschi link (no browser opened)");
}
export {
  register
};
