# Built-in types: data

Databases, caches, search engines, warehouses and storage: the components that keep data, with the operations their clients send. Generated from [data.proschi](../../frontend/src/dsl/stdlib/data.proschi); [component types](../TYPES.md) explains how to read and extend them.

## Data

A component that keeps data: a database, cache, search index, warehouse or bucket.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Component](core.md#component)
- **Extended by:** [Database](#database), [NoSQL Database](#nosql-database), [Coordination Store](#coordination-store), [Cache](#cache), [Search Engine](#search-engine), [Data Warehouse](#data-warehouse), [Time Series Store](#time-series-store), [Object Storage](#object-storage), [Shared File System](#shared-file-system), [Block Storage](#block-storage)
- **Read:** `READ`, `FETCH`, `LOOKUP`
- **Write:** `WRITE`, `SAVE`, `STORE`, `RECORD`, `MARK`, `RESERVE`, `HOLD`, `BOOK`

## Database

A relational database queried with SQL, whose product does not matter.

- **Extends:** [Data](#data) › [Component](core.md#component)
- **Extended by:** [PostgreSQL](#postgresql), [MySQL](#mysql), [SQLite](#sqlite), [Oracle](#oracle), [SQL Server](#sql-server), [Distributed SQL Database](#distributed-sql-database), [AWS RDS](cloud.md#aws-rds), [AWS Aurora](cloud.md#aws-aurora), [GCP Cloud SQL](cloud.md#gcp-cloud-sql)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** `SELECT`, `WITH`, `EXPLAIN`, `SHOW`, `BEGIN`, `ROLLBACK`, plus 3 from [Data](#data)
- **Write:** `INSERT`, `UPDATE`, `DELETE`, `UPSERT`, `MERGE`, `TRUNCATE`, `COMMIT`, `LOCK`, `CREATE`, `ALTER`, `DROP`, plus 8 from [Data](#data)

## PostgreSQL

PostgreSQL, the open source relational database.

- **Extends:** [Database](#database) › [Data](#data) › [Component](core.md#component)
- **Extended by:** [TimescaleDB](#timescaledb), [Azure Database for PostgreSQL](cloud.md#azure-database-for-postgresql)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** `LISTEN`, plus 6 from [Database](#database), 3 from [Data](#data)
- **Write:** `NOTIFY`, `COPY`, `VACUUM`, plus 11 from [Database](#database), 8 from [Data](#data)

## MySQL

MySQL, the open source relational database.

- **Extends:** [Database](#database) › [Data](#data) › [Component](core.md#component)
- **Extended by:** [MariaDB](#mariadb), [Azure Database for MySQL](cloud.md#azure-database-for-mysql)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** 6 from [Database](#database), 3 from [Data](#data)
- **Write:** `REPLACE`, plus 11 from [Database](#database), 8 from [Data](#data)

## MariaDB

MariaDB, the community fork of MySQL.

- **Extends:** [MySQL](#mysql) › [Database](#database) › [Data](#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** 6 from [Database](#database), 3 from [Data](#data)
- **Write:** 1 from [MySQL](#mysql), 11 from [Database](#database), 8 from [Data](#data)

## SQLite

SQLite, the embedded relational database in a single file.

- **Extends:** [Database](#database) › [Data](#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** 6 from [Database](#database), 3 from [Data](#data)
- **Write:** 11 from [Database](#database), 8 from [Data](#data)

## Oracle

Oracle Database, the commercial relational database.

- **Extends:** [Database](#database) › [Data](#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** 6 from [Database](#database), 3 from [Data](#data)
- **Write:** 11 from [Database](#database), 8 from [Data](#data)

## SQL Server

Microsoft SQL Server, the commercial relational database.

- **Extends:** [Database](#database) › [Data](#data) › [Component](core.md#component)
- **Extended by:** [Azure SQL](cloud.md#azure-sql)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** 6 from [Database](#database), 3 from [Data](#data)
- **Write:** 11 from [Database](#database), 8 from [Data](#data)

## TimescaleDB

TimescaleDB, PostgreSQL extended for time series.

- **Extends:** [PostgreSQL](#postgresql) › [Database](#database) › [Data](#data) › [Component](core.md#component)
- **Kind:** `analytics`
- **Protocol:** `SQL`
- **Read:** 1 from [PostgreSQL](#postgresql), 6 from [Database](#database), 3 from [Data](#data)
- **Write:** 3 from [PostgreSQL](#postgresql), 11 from [Database](#database), 8 from [Data](#data)

## Distributed SQL Database

A relational database that shards and replicates itself across nodes, keeping transactions.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Database](#database) › [Data](#data) › [Component](core.md#component)
- **Extended by:** [CockroachDB](#cockroachdb), [YugabyteDB](#yugabytedb), [TiDB](#tidb), [Vitess](#vitess), [GCP Spanner](cloud.md#gcp-spanner)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Icon:** `Database`
- **Read:** 6 from [Database](#database), 3 from [Data](#data)
- **Write:** 11 from [Database](#database), 8 from [Data](#data)

## CockroachDB

CockroachDB, a distributed SQL database that speaks the PostgreSQL protocol.

- **Extends:** [Distributed SQL Database](#distributed-sql-database) › [Database](#database) › [Data](#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** 6 from [Database](#database), 3 from [Data](#data)
- **Write:** 11 from [Database](#database), 8 from [Data](#data)

## YugabyteDB

YugabyteDB, a distributed SQL database compatible with PostgreSQL.

- **Extends:** [Distributed SQL Database](#distributed-sql-database) › [Database](#database) › [Data](#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** 6 from [Database](#database), 3 from [Data](#data)
- **Write:** 11 from [Database](#database), 8 from [Data](#data)

## TiDB

TiDB, a distributed SQL database compatible with MySQL.

- **Extends:** [Distributed SQL Database](#distributed-sql-database) › [Database](#database) › [Data](#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** 6 from [Database](#database), 3 from [Data](#data)
- **Write:** 11 from [Database](#database), 8 from [Data](#data)

## Vitess

Vitess, which shards MySQL behind one SQL endpoint.

- **Extends:** [Distributed SQL Database](#distributed-sql-database) › [Database](#database) › [Data](#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** 6 from [Database](#database), 3 from [Data](#data)
- **Write:** 11 from [Database](#database), 8 from [Data](#data)

## NoSQL Database

A non-relational database that partitions data by key, whose product does not matter.

- **Extends:** [Data](#data) › [Component](core.md#component)
- **Extended by:** [DynamoDB](#dynamodb), [Document NoSQL Database](#document-nosql-database), [Wide-Column NoSQL Database](#wide-column-nosql-database), [Graph NoSQL Database](#graph-nosql-database)
- **Kind:** `database`
- **Read:** `GET`, `SCAN`, plus 3 from [Data](#data)
- **Write:** `PUT`, `SET`, `DELETE`, plus 8 from [Data](#data)

## DynamoDB

DynamoDB, the managed key-value and document database: reads by key or partition, a Scan reads the whole table.

- **Extends:** [NoSQL Database](#nosql-database) › [Data](#data) › [Component](core.md#component)
- **Extended by:** [AWS DynamoDB](cloud.md#aws-dynamodb)
- **Kind:** `database`
- **Read:** `GetItem`, `BatchGetItem`, `Query`, `TransactGetItems`, `DescribeTable`, `Scan` (latency ×10, cost ×25), plus 1 from [NoSQL Database](#nosql-database), 3 from [Data](#data)
- **Write:** `PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem`, `TransactWriteItems`, `ExecuteStatement`, `CreateTable`, `UpdateTable`, `DeleteTable`, plus 3 from [NoSQL Database](#nosql-database), 8 from [Data](#data)

## Document NoSQL Database

A NoSQL database that stores JSON-like documents and queries their fields.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [NoSQL Database](#nosql-database) › [Data](#data) › [Component](core.md#component)
- **Extended by:** [MongoDB](#mongodb), [CouchDB](#couchdb), [Couchbase](#couchbase), [GCP Firestore](cloud.md#gcp-firestore), [Azure Cosmos DB](cloud.md#azure-cosmos-db)
- **Kind:** `database`
- **Icon:** `NoSQL Database`
- **Read:** 2 from [NoSQL Database](#nosql-database), 3 from [Data](#data)
- **Write:** 3 from [NoSQL Database](#nosql-database), 8 from [Data](#data)

## MongoDB

MongoDB, the document database.

- **Extends:** [Document NoSQL Database](#document-nosql-database) › [NoSQL Database](#nosql-database) › [Data](#data) › [Component](core.md#component)
- **Extended by:** [AWS DocumentDB](cloud.md#aws-documentdb)
- **Kind:** `database`
- **Read:** `find`, `findOne`, `aggregate`, `countDocuments`, `estimatedDocumentCount`, `distinct`, `watch`, plus 2 from [NoSQL Database](#nosql-database), 3 from [Data](#data)
- **Write:** `insertOne`, `insertMany`, `updateOne`, `updateMany`, `replaceOne`, `deleteOne`, `deleteMany`, `findOneAndUpdate`, `findOneAndReplace`, `findOneAndDelete`, `bulkWrite`, `createIndex`, plus 3 from [NoSQL Database](#nosql-database), 8 from [Data](#data)

## CouchDB

Apache CouchDB, a document database with an HTTP API and multi-primary replication.

- **Extends:** [Document NoSQL Database](#document-nosql-database) › [NoSQL Database](#nosql-database) › [Data](#data) › [Component](core.md#component)
- **Kind:** `database`
- **Read:** 2 from [NoSQL Database](#nosql-database), 3 from [Data](#data)
- **Write:** 3 from [NoSQL Database](#nosql-database), 8 from [Data](#data)

## Couchbase

Couchbase, a document database with a built-in cache.

- **Extends:** [Document NoSQL Database](#document-nosql-database) › [NoSQL Database](#nosql-database) › [Data](#data) › [Component](core.md#component)
- **Kind:** `database`
- **Read:** `lookupIn`, `exists`, `query`, plus 2 from [NoSQL Database](#nosql-database), 3 from [Data](#data)
- **Write:** `upsert`, `insert`, `replace`, `remove`, `mutateIn`, `touch`, `increment`, `decrement`, plus 3 from [NoSQL Database](#nosql-database), 8 from [Data](#data)

## Wide-Column NoSQL Database

A NoSQL database of rows with many columns, partitioned by key and sorted within a partition.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [NoSQL Database](#nosql-database) › [Data](#data) › [Component](core.md#component)
- **Extended by:** [Cassandra](#cassandra), [HBase](#hbase), [GCP Bigtable](cloud.md#gcp-bigtable)
- **Kind:** `database`
- **Icon:** `NoSQL Database`
- **Read:** 2 from [NoSQL Database](#nosql-database), 3 from [Data](#data)
- **Write:** 3 from [NoSQL Database](#nosql-database), 8 from [Data](#data)

## Cassandra

Apache Cassandra, the wide-column database queried with CQL.

- **Extends:** [Wide-Column NoSQL Database](#wide-column-nosql-database) › [NoSQL Database](#nosql-database) › [Data](#data) › [Component](core.md#component)
- **Extended by:** [ScyllaDB](#scylladb), [AWS Keyspaces](cloud.md#aws-keyspaces)
- **Kind:** `database`
- **Protocol:** `CQL`
- **Read:** `SELECT`, plus 2 from [NoSQL Database](#nosql-database), 3 from [Data](#data)
- **Write:** `INSERT`, `UPDATE`, `DELETE`, `BATCH`, `TRUNCATE`, plus 2 from [NoSQL Database](#nosql-database), 8 from [Data](#data)

## ScyllaDB

ScyllaDB, a Cassandra-compatible database written in C++.

- **Extends:** [Cassandra](#cassandra) › [Wide-Column NoSQL Database](#wide-column-nosql-database) › [NoSQL Database](#nosql-database) › [Data](#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `CQL`
- **Read:** 1 from [Cassandra](#cassandra), 2 from [NoSQL Database](#nosql-database), 3 from [Data](#data)
- **Write:** 5 from [Cassandra](#cassandra), 2 from [NoSQL Database](#nosql-database), 8 from [Data](#data)

## HBase

Apache HBase, the wide-column database on HDFS.

- **Extends:** [Wide-Column NoSQL Database](#wide-column-nosql-database) › [NoSQL Database](#nosql-database) › [Data](#data) › [Component](core.md#component)
- **Kind:** `database`
- **Read:** `Exists`, `Scan` (latency ×10, cost ×25), plus 1 from [NoSQL Database](#nosql-database), 3 from [Data](#data)
- **Write:** `Increment`, `Append`, `CheckAndMutate`, plus 3 from [NoSQL Database](#nosql-database), 8 from [Data](#data)

## Graph NoSQL Database

A graph database: nodes and relationships, queried by pattern.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [NoSQL Database](#nosql-database) › [Data](#data) › [Component](core.md#component)
- **Extended by:** [Neo4j](#neo4j), [AWS Neptune](cloud.md#aws-neptune)
- **Kind:** `database`
- **Protocol:** `Cypher`
- **Icon:** `NoSQL Database`
- **Read:** `MATCH`, `OPTIONAL`, `RETURN`, `CALL`, plus 2 from [NoSQL Database](#nosql-database), 3 from [Data](#data)
- **Write:** `CREATE`, `MERGE`, `DELETE`, `DETACH`, `SET`, `REMOVE`, plus 1 from [NoSQL Database](#nosql-database), 8 from [Data](#data)

## Neo4j

Neo4j, the graph database queried with Cypher.

- **Extends:** [Graph NoSQL Database](#graph-nosql-database) › [NoSQL Database](#nosql-database) › [Data](#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `Cypher`
- **Read:** 4 from [Graph NoSQL Database](#graph-nosql-database), 2 from [NoSQL Database](#nosql-database), 3 from [Data](#data)
- **Write:** 6 from [Graph NoSQL Database](#graph-nosql-database), 1 from [NoSQL Database](#nosql-database), 8 from [Data](#data)

## Coordination Store

A small, strongly consistent store for configuration, leader election and locks.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Data](#data) › [Component](core.md#component)
- **Extended by:** [etcd](#etcd), [ZooKeeper](#zookeeper)
- **Kind:** `database`
- **Read:** `GET`, `WATCH`, plus 3 from [Data](#data)
- **Write:** `PUT`, `DELETE`, plus 8 from [Data](#data)

## etcd

etcd, the consistent key-value store behind Kubernetes.

- **Extends:** [Coordination Store](#coordination-store) › [Data](#data) › [Component](core.md#component)
- **Kind:** `database`
- **Read:** `Range`, `LeaseTimeToLive`, plus 2 from [Coordination Store](#coordination-store), 3 from [Data](#data)
- **Write:** `DeleteRange`, `Txn`, `Compact`, `LeaseGrant`, `LeaseRevoke`, `LeaseKeepAlive`, plus 2 from [Coordination Store](#coordination-store), 8 from [Data](#data)

## ZooKeeper

Apache ZooKeeper, the coordination service of znodes and watches.

- **Extends:** [Coordination Store](#coordination-store) › [Data](#data) › [Component](core.md#component)
- **Kind:** `database`
- **Read:** `getData`, `getChildren`, `exists`, `getACL`, `sync`, plus 2 from [Coordination Store](#coordination-store), 3 from [Data](#data)
- **Write:** `create`, `setData`, `setACL`, `multi`, plus 2 from [Coordination Store](#coordination-store), 8 from [Data](#data)

## Cache

An in-memory key-value cache, whose product does not matter.

- **Extends:** [Data](#data) › [Component](core.md#component)
- **Extended by:** [Redis](#redis), [Memcached](#memcached), [Hazelcast](#hazelcast), [Aerospike](#aerospike)
- **Kind:** `cache`
- **Read:** `GET`, `MGET`, plus 3 from [Data](#data)
- **Write:** `SET`, `DELETE`, `EXPIRE`, plus 8 from [Data](#data)

## Redis

Redis, the in-memory data store, used as a cache.

- **Extends:** [Cache](#cache) › [Data](#data) › [Component](core.md#component)
- **Extended by:** [Valkey](#valkey), [KeyDB](#keydb), [Dragonfly](#dragonfly), [AWS ElastiCache](cloud.md#aws-elasticache), [GCP Memorystore](cloud.md#gcp-memorystore), [Azure Cache for Redis](cloud.md#azure-cache-for-redis)
- **Kind:** `cache`
- **Protocol:** `RESP`
- **Read:** `GETRANGE`, `STRLEN`, `EXISTS`, `TTL`, `PTTL`, `TYPE`, `KEYS`, `SCAN`, `HGET`, `HMGET`, `HGETALL`, `HEXISTS`, `HKEYS`, `HVALS`, `HLEN`, `HSCAN`, `LRANGE`, `LLEN`, `LINDEX`, `SMEMBERS`, `SISMEMBER`, `SMISMEMBER`, `SCARD`, `SRANDMEMBER`, `SINTER`, `SUNION`, `SDIFF`, `SSCAN`, `ZRANGE`, `ZREVRANGE`, `ZRANGEBYSCORE`, `ZREVRANGEBYSCORE`, `ZRANGEBYLEX`, `ZSCORE`, `ZMSCORE`, `ZRANK`, `ZREVRANK`, `ZCARD`, `ZCOUNT`, `ZSCAN`, `GETBIT`, `BITCOUNT`, `BITPOS`, `PFCOUNT`, `GEOSEARCH`, `GEODIST`, `GEOPOS`, `GEOHASH`, `GEORADIUS`, `GEORADIUSBYMEMBER`, `SUBSCRIBE`, `PSUBSCRIBE`, `UNSUBSCRIBE`, `PUNSUBSCRIBE`, `SSUBSCRIBE`, `XREAD`, `XREADGROUP`, `XRANGE`, `XREVRANGE`, `XLEN`, `XPENDING`, `XINFO`, `MULTI`, `WATCH`, `UNWATCH`, `DISCARD`, `PING`, plus 2 from [Cache](#cache), 3 from [Data](#data)
- **Write:** `SETNX`, `SETEX`, `PSETEX`, `GETSET`, `GETDEL`, `GETEX`, `MSET`, `MSETNX`, `APPEND`, `SETRANGE`, `INCR`, `INCRBY`, `INCRBYFLOAT`, `DECR`, `DECRBY`, `DEL`, `UNLINK`, `PEXPIRE`, `EXPIREAT`, `PEXPIREAT`, `PERSIST`, `RENAME`, `COPY`, `HSET`, `HSETNX`, `HMSET`, `HDEL`, `HINCRBY`, `HINCRBYFLOAT`, `LPUSH`, `RPUSH`, `LPUSHX`, `RPUSHX`, `LPOP`, `RPOP`, `BLPOP`, `BRPOP`, `LSET`, `LREM`, `LTRIM`, `LINSERT`, `LMOVE`, `BLMOVE`, `SADD`, `SREM`, `SPOP`, `SMOVE`, `SINTERSTORE`, `SUNIONSTORE`, `SDIFFSTORE`, `ZADD`, `ZREM`, `ZINCRBY`, `ZPOPMIN`, `ZPOPMAX`, `BZPOPMIN`, `BZPOPMAX`, `ZREMRANGEBYSCORE`, `ZREMRANGEBYRANK`, `ZUNIONSTORE`, `ZINTERSTORE`, `ZRANGESTORE`, `SETBIT`, `BITOP`, `PFADD`, `PFMERGE`, `GEOADD`, `GEOSEARCHSTORE`, `PUBLISH`, `SPUBLISH`, `XADD`, `XACK`, `XCLAIM`, `XAUTOCLAIM`, `XDEL`, `XTRIM`, `XGROUP`, `EXEC`, `EVAL`, `EVALSHA`, `FCALL`, plus 3 from [Cache](#cache), 8 from [Data](#data)

## Valkey

Valkey, the open source fork of Redis.

- **Extends:** [Redis](#redis) › [Cache](#cache) › [Data](#data) › [Component](core.md#component)
- **Kind:** `cache`
- **Protocol:** `RESP`
- **Read:** 67 from [Redis](#redis), 2 from [Cache](#cache), 3 from [Data](#data)
- **Write:** 81 from [Redis](#redis), 3 from [Cache](#cache), 8 from [Data](#data)

## KeyDB

KeyDB, a multithreaded fork of Redis.

- **Extends:** [Redis](#redis) › [Cache](#cache) › [Data](#data) › [Component](core.md#component)
- **Kind:** `cache`
- **Protocol:** `RESP`
- **Read:** 67 from [Redis](#redis), 2 from [Cache](#cache), 3 from [Data](#data)
- **Write:** 81 from [Redis](#redis), 3 from [Cache](#cache), 8 from [Data](#data)

## Dragonfly

Dragonfly, an in-memory store compatible with Redis.

- **Extends:** [Redis](#redis) › [Cache](#cache) › [Data](#data) › [Component](core.md#component)
- **Kind:** `cache`
- **Protocol:** `RESP`
- **Read:** 67 from [Redis](#redis), 2 from [Cache](#cache), 3 from [Data](#data)
- **Write:** 81 from [Redis](#redis), 3 from [Cache](#cache), 8 from [Data](#data)

## Memcached

Memcached, the simple distributed in-memory cache.

- **Extends:** [Cache](#cache) › [Data](#data) › [Component](core.md#component)
- **Kind:** `cache`
- **Read:** `GETS`, plus 2 from [Cache](#cache), 3 from [Data](#data)
- **Write:** `ADD`, `REPLACE`, `APPEND`, `PREPEND`, `CAS`, `INCR`, `DECR`, `TOUCH`, `GAT`, `GATS`, `FLUSH_ALL`, plus 3 from [Cache](#cache), 8 from [Data](#data)

## Hazelcast

Hazelcast, the in-memory data grid.

- **Extends:** [Cache](#cache) › [Data](#data) › [Component](core.md#component)
- **Kind:** `cache`
- **Read:** 2 from [Cache](#cache), 3 from [Data](#data)
- **Write:** 3 from [Cache](#cache), 8 from [Data](#data)

## Aerospike

Aerospike, the key-value store tuned for memory and flash.

- **Extends:** [Cache](#cache) › [Data](#data) › [Component](core.md#component)
- **Kind:** `cache`
- **Read:** 2 from [Cache](#cache), 3 from [Data](#data)
- **Write:** 3 from [Cache](#cache), 8 from [Data](#data)

## Search Engine

A full-text search index, whose product does not matter.

- **Extends:** [Data](#data) › [Component](core.md#component)
- **Extended by:** [Elasticsearch](#elasticsearch), [Solr](#solr), [Meilisearch](#meilisearch), [Typesense](#typesense), [Algolia](#algolia), [Azure AI Search](cloud.md#azure-ai-search)
- **Kind:** `search`
- **Read:** `Search`, `Get`, `KNN`, plus 3 from [Data](#data)
- **Write:** `Index`, `Upsert`, `Delete`, plus 8 from [Data](#data)

## Elasticsearch

Elasticsearch, the distributed search engine on Lucene.

- **Extends:** [Search Engine](#search-engine) › [Data](#data) › [Component](core.md#component)
- **Extended by:** [OpenSearch](#opensearch)
- **Kind:** `search`
- **Read:** `Mget`, `Count`, `MultiSearch`, `Scroll`, `Explain`, `_search`, `_msearch`, `_count`, plus 3 from [Search Engine](#search-engine), 3 from [Data](#data)
- **Write:** `Bulk`, `Update`, `Create`, `UpdateByQuery`, `DeleteByQuery`, `Reindex`, `Refresh`, `_bulk`, `_doc`, `_update`, plus 3 from [Search Engine](#search-engine), 8 from [Data](#data)

## OpenSearch

OpenSearch, the open source fork of Elasticsearch.

- **Extends:** [Elasticsearch](#elasticsearch) › [Search Engine](#search-engine) › [Data](#data) › [Component](core.md#component)
- **Extended by:** [AWS OpenSearch](cloud.md#aws-opensearch)
- **Kind:** `search`
- **Read:** 8 from [Elasticsearch](#elasticsearch), 3 from [Search Engine](#search-engine), 3 from [Data](#data)
- **Write:** 10 from [Elasticsearch](#elasticsearch), 3 from [Search Engine](#search-engine), 8 from [Data](#data)

## Solr

Apache Solr, the search server on Lucene.

- **Extends:** [Search Engine](#search-engine) › [Data](#data) › [Component](core.md#component)
- **Kind:** `search`
- **Read:** 3 from [Search Engine](#search-engine), 3 from [Data](#data)
- **Write:** 3 from [Search Engine](#search-engine), 8 from [Data](#data)

## Meilisearch

Meilisearch, a fast search engine for search-as-you-type.

- **Extends:** [Search Engine](#search-engine) › [Data](#data) › [Component](core.md#component)
- **Kind:** `search`
- **Read:** 3 from [Search Engine](#search-engine), 3 from [Data](#data)
- **Write:** 3 from [Search Engine](#search-engine), 8 from [Data](#data)

## Typesense

Typesense, an in-memory search engine that tolerates typos.

- **Extends:** [Search Engine](#search-engine) › [Data](#data) › [Component](core.md#component)
- **Kind:** `search`
- **Read:** 3 from [Search Engine](#search-engine), 3 from [Data](#data)
- **Write:** 3 from [Search Engine](#search-engine), 8 from [Data](#data)

## Algolia

Algolia, the hosted search API.

- **Extends:** [Search Engine](#search-engine) › [Data](#data) › [Component](core.md#component)
- **Kind:** `search`
- **Read:** 3 from [Search Engine](#search-engine), 3 from [Data](#data)
- **Write:** 3 from [Search Engine](#search-engine), 8 from [Data](#data)

## Data Warehouse

A column store for analytical SQL over large data, whose product does not matter.

- **Extends:** [Data](#data) › [Component](core.md#component)
- **Extended by:** [Snowflake](#snowflake), [ClickHouse](#clickhouse), [Apache Druid](#apache-druid), [Apache Pinot](#apache-pinot), [Databricks](#databricks), [AWS Redshift](cloud.md#aws-redshift), [AWS Athena](cloud.md#aws-athena), [GCP BigQuery](cloud.md#gcp-bigquery)
- **Kind:** `analytics`
- **Protocol:** `SQL`
- **Read:** `SELECT`, `WITH`, `EXPLAIN`, `SHOW`, plus 3 from [Data](#data)
- **Write:** `INSERT`, `UPDATE`, `DELETE`, `UPSERT`, `MERGE`, `COPY`, `TRUNCATE`, `CREATE`, `DROP`, plus 8 from [Data](#data)

## Snowflake

Snowflake, the cloud data warehouse.

- **Extends:** [Data Warehouse](#data-warehouse) › [Data](#data) › [Component](core.md#component)
- **Kind:** `analytics`
- **Protocol:** `SQL`
- **Read:** 4 from [Data Warehouse](#data-warehouse), 3 from [Data](#data)
- **Write:** 9 from [Data Warehouse](#data-warehouse), 8 from [Data](#data)

## ClickHouse

ClickHouse, the column-oriented OLAP database.

- **Extends:** [Data Warehouse](#data-warehouse) › [Data](#data) › [Component](core.md#component)
- **Kind:** `analytics`
- **Protocol:** `SQL`
- **Read:** 4 from [Data Warehouse](#data-warehouse), 3 from [Data](#data)
- **Write:** 9 from [Data Warehouse](#data-warehouse), 8 from [Data](#data)

## Apache Druid

Apache Druid, the real-time analytics database.

- **Extends:** [Data Warehouse](#data-warehouse) › [Data](#data) › [Component](core.md#component)
- **Kind:** `analytics`
- **Protocol:** `SQL`
- **Read:** 4 from [Data Warehouse](#data-warehouse), 3 from [Data](#data)
- **Write:** 9 from [Data Warehouse](#data-warehouse), 8 from [Data](#data)

## Apache Pinot

Apache Pinot, the real-time OLAP store for user-facing analytics.

- **Extends:** [Data Warehouse](#data-warehouse) › [Data](#data) › [Component](core.md#component)
- **Kind:** `analytics`
- **Protocol:** `SQL`
- **Read:** 4 from [Data Warehouse](#data-warehouse), 3 from [Data](#data)
- **Write:** 9 from [Data Warehouse](#data-warehouse), 8 from [Data](#data)

## Databricks

Databricks, the lakehouse platform on Spark.

- **Extends:** [Data Warehouse](#data-warehouse) › [Data](#data) › [Component](core.md#component)
- **Kind:** `analytics`
- **Protocol:** `SQL`
- **Read:** 4 from [Data Warehouse](#data-warehouse), 3 from [Data](#data)
- **Write:** 9 from [Data Warehouse](#data-warehouse), 8 from [Data](#data)

## Time Series Store

A database of timestamped measurements, queried over time ranges.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Data](#data) › [Component](core.md#component)
- **Extended by:** [InfluxDB](#influxdb), [Prometheus](#prometheus)
- **Kind:** `analytics`
- **Read:** `QUERY`, `SELECT`, plus 3 from [Data](#data)
- **Write:** `INSERT`, plus 8 from [Data](#data)

## InfluxDB

InfluxDB, the time series database.

- **Extends:** [Time Series Store](#time-series-store) › [Data](#data) › [Component](core.md#component)
- **Kind:** `analytics`
- **Read:** 2 from [Time Series Store](#time-series-store), 3 from [Data](#data)
- **Write:** 1 from [Time Series Store](#time-series-store), 8 from [Data](#data)

## Prometheus

Prometheus, the monitoring system and its time series store.

- **Extends:** [Time Series Store](#time-series-store) › [Data](#data) › [Component](core.md#component)
- **Kind:** `analytics`
- **Read:** 2 from [Time Series Store](#time-series-store), 3 from [Data](#data)
- **Write:** 1 from [Time Series Store](#time-series-store), 8 from [Data](#data)

## Object Storage

A bucket of objects (files) by key, whose product does not matter.

- **Extends:** [Data](#data) › [Component](core.md#component)
- **Extended by:** [Ceph](#ceph), [AWS S3](cloud.md#aws-s3), [GCP Cloud Storage](cloud.md#gcp-cloud-storage), [Azure Blob Storage](cloud.md#azure-blob-storage)
- **Kind:** `storage`
- **Protocol:** `HTTP`
- **Read:** `GET`, `HEAD`, `LIST`, plus 3 from [Data](#data)
- **Write:** `PUT`, `DELETE`, `UPLOAD`, plus 8 from [Data](#data)

## MinIO

MinIO, the self-hosted object storage with the S3 API.

- **Extends:** [AWS S3](cloud.md#aws-s3) › [Object Storage](#object-storage) › [Data](#data) › [Component](core.md#component)
- **Kind:** `storage`
- **Protocol:** `HTTP`
- **Read:** 11 from [AWS S3](cloud.md#aws-s3), 3 from [Object Storage](#object-storage), 3 from [Data](#data)
- **Write:** 14 from [AWS S3](cloud.md#aws-s3), 3 from [Object Storage](#object-storage), 8 from [Data](#data)

## Ceph

Ceph, the distributed object, block and file storage.

- **Extends:** [Object Storage](#object-storage) › [Data](#data) › [Component](core.md#component)
- **Kind:** `storage`
- **Protocol:** `HTTP`
- **Read:** 3 from [Object Storage](#object-storage), 3 from [Data](#data)
- **Write:** 3 from [Object Storage](#object-storage), 8 from [Data](#data)

## Shared File System

A file system many machines mount at once.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Data](#data) › [Component](core.md#component)
- **Extended by:** [HDFS](#hdfs), [AWS EFS](cloud.md#aws-efs), [Azure Files](cloud.md#azure-files)
- **Kind:** `storage`
- **Read:** `OPEN`, `LIST`, plus 3 from [Data](#data)
- **Write:** `APPEND`, plus 8 from [Data](#data)

## HDFS

HDFS, the Hadoop distributed file system.

- **Extends:** [Shared File System](#shared-file-system) › [Data](#data) › [Component](core.md#component)
- **Kind:** `storage`
- **Read:** 2 from [Shared File System](#shared-file-system), 3 from [Data](#data)
- **Write:** 1 from [Shared File System](#shared-file-system), 8 from [Data](#data)

## Block Storage

A disk attached to one machine.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Data](#data) › [Component](core.md#component)
- **Extended by:** [AWS EBS](cloud.md#aws-ebs), [GCP Persistent Disk](cloud.md#gcp-persistent-disk), [Azure Disk Storage](cloud.md#azure-disk-storage)
- **Kind:** `storage`
- **Read:** 3 from [Data](#data)
- **Write:** 8 from [Data](#data)
