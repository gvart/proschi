# Built-in types: messaging

Message queues and brokers, with the operations that send and receive. Generated from [messaging.proschi](../../frontend/src/dsl/stdlib/messaging.proschi); [component types](../TYPES.md) explains how to read and extend them.

## Messaging

A component that takes a message and hands it on later: a queue or a broker.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Component](core.md#component)
- **Extended by:** [Message Queue](#message-queue), [Message Broker](#message-broker)
- **Read:** `RECEIVE`, `SUBSCRIBE`, `UNSUBSCRIBE`, `READ`
- **Write:** `SEND`, `PUBLISH`, `EMIT`, `ENQUEUE`, `WRITE`, `ACK`, `NACK`

## Message Queue

A queue of jobs: each message goes to one consumer, which deletes it when done.

- **Extends:** [Messaging](#messaging) › [Component](core.md#component)
- **Extended by:** [SQS](#sqs), [Redis Queue](#redis-queue), [ZeroMQ](#zeromq), [Azure Queue Storage](cloud.md#azure-queue-storage)
- **Kind:** `queue`
- **Read:** `DEQUEUE`, `PEEK`, `POLL`, plus 4 from [Messaging](#messaging)
- **Write:** 7 from [Messaging](#messaging)

## Message Broker

A broker of topics or streams: every subscriber gets each message, and the log can be replayed.

- **Extends:** [Messaging](#messaging) › [Component](core.md#component)
- **Extended by:** [Kafka](#kafka), [RabbitMQ](#rabbitmq), [NATS](#nats), [Apache Pulsar](#apache-pulsar), [ActiveMQ](#activemq), [AWS SNS](cloud.md#aws-sns), [AWS EventBridge](cloud.md#aws-eventbridge), [AWS Kinesis](cloud.md#aws-kinesis), [GCP Pub/Sub](cloud.md#gcp-pubsub), [Azure Service Bus](cloud.md#azure-service-bus), [Azure Event Hubs](cloud.md#azure-event-hubs), [Azure Event Grid](cloud.md#azure-event-grid)
- **Kind:** `broker`
- **Read:** `CONSUME`, `FETCH`, plus 4 from [Messaging](#messaging)
- **Write:** `PRODUCE`, plus 7 from [Messaging](#messaging)

## SQS

SQS, the managed message queue of AWS.

- **Extends:** [Message Queue](#message-queue) › [Messaging](#messaging) › [Component](core.md#component)
- **Extended by:** [AWS SQS](cloud.md#aws-sqs)
- **Kind:** `queue`
- **Read:** `ReceiveMessage`, `GetQueueAttributes`, `GetQueueUrl`, `ListQueues`, plus 3 from [Message Queue](#message-queue), 4 from [Messaging](#messaging)
- **Write:** `SendMessage`, `SendMessageBatch`, `DeleteMessage`, `DeleteMessageBatch`, `ChangeMessageVisibility`, `ChangeMessageVisibilityBatch`, `PurgeQueue`, `CreateQueue`, `DeleteQueue`, `SetQueueAttributes`, plus 7 from [Messaging](#messaging)

## Redis Queue

A queue on Redis: a list, a stream or pub/sub channels.

- **Extends:** [Message Queue](#message-queue) › [Messaging](#messaging) › [Component](core.md#component)
- **Kind:** `queue`
- **Protocol:** `RESP`
- **Read:** `XREAD`, `XREADGROUP`, `XRANGE`, `XLEN`, `XPENDING`, `LRANGE`, `LLEN`, `PSUBSCRIBE`, plus 3 from [Message Queue](#message-queue), 4 from [Messaging](#messaging)
- **Write:** `XADD`, `XACK`, `XCLAIM`, `XAUTOCLAIM`, `XDEL`, `XTRIM`, `XGROUP`, `LPUSH`, `RPUSH`, `LPOP`, `RPOP`, `BLPOP`, `BRPOP`, `LMOVE`, `BLMOVE`, plus 7 from [Messaging](#messaging)

## ZeroMQ

ZeroMQ, the brokerless messaging library of sockets.

- **Extends:** [Message Queue](#message-queue) › [Messaging](#messaging) › [Component](core.md#component)
- **Kind:** `queue`
- **Read:** `RECV`, plus 3 from [Message Queue](#message-queue), 4 from [Messaging](#messaging)
- **Write:** 7 from [Messaging](#messaging)

## Kafka

Apache Kafka, the distributed log of partitioned topics.

- **Extends:** [Message Broker](#message-broker) › [Messaging](#messaging) › [Component](core.md#component)
- **Extended by:** [Redpanda](#redpanda), [AWS MSK](cloud.md#aws-msk)
- **Kind:** `broker`
- **Read:** `Poll`, `OffsetFetch`, `ListOffsets`, `Metadata`, plus 2 from [Message Broker](#message-broker), 4 from [Messaging](#messaging)
- **Write:** `Commit`, `OffsetCommit`, `AddPartitionsToTxn`, `EndTxn`, `DeleteRecords`, `CreateTopics`, `DeleteTopics`, `CreatePartitions`, plus 1 from [Message Broker](#message-broker), 7 from [Messaging](#messaging)

## Redpanda

Redpanda, a Kafka-compatible streaming platform written in C++.

- **Extends:** [Kafka](#kafka) › [Message Broker](#message-broker) › [Messaging](#messaging) › [Component](core.md#component)
- **Kind:** `broker`
- **Read:** 4 from [Kafka](#kafka), 2 from [Message Broker](#message-broker), 4 from [Messaging](#messaging)
- **Write:** 8 from [Kafka](#kafka), 1 from [Message Broker](#message-broker), 7 from [Messaging](#messaging)

## RabbitMQ

RabbitMQ, the AMQP broker of exchanges and queues.

- **Extends:** [Message Broker](#message-broker) › [Messaging](#messaging) › [Component](core.md#component)
- **Kind:** `broker`
- **Protocol:** `AMQP`
- **Read:** `BasicGet`, `BasicConsume`, plus 2 from [Message Broker](#message-broker), 4 from [Messaging](#messaging)
- **Write:** `BasicPublish`, `BasicAck`, `BasicNack`, `BasicReject`, `QueueDeclare`, `ExchangeDeclare`, `QueueBind`, `QueuePurge`, plus 1 from [Message Broker](#message-broker), 7 from [Messaging](#messaging)

## NATS

NATS, the lightweight messaging system, with JetStream for persistence.

- **Extends:** [Message Broker](#message-broker) › [Messaging](#messaging) › [Component](core.md#component)
- **Kind:** `broker`
- **Read:** `REQUEST`, `SUB`, plus 2 from [Message Broker](#message-broker), 4 from [Messaging](#messaging)
- **Write:** `PUB`, `REPLY`, plus 1 from [Message Broker](#message-broker), 7 from [Messaging](#messaging)

## Apache Pulsar

Apache Pulsar, the broker of topics with tiered storage.

- **Extends:** [Message Broker](#message-broker) › [Messaging](#messaging) › [Component](core.md#component)
- **Kind:** `broker`
- **Read:** 2 from [Message Broker](#message-broker), 4 from [Messaging](#messaging)
- **Write:** 1 from [Message Broker](#message-broker), 7 from [Messaging](#messaging)

## ActiveMQ

Apache ActiveMQ, the JMS message broker.

- **Extends:** [Message Broker](#message-broker) › [Messaging](#messaging) › [Component](core.md#component)
- **Kind:** `broker`
- **Read:** 2 from [Message Broker](#message-broker), 4 from [Messaging](#messaging)
- **Write:** 1 from [Message Broker](#message-broker), 7 from [Messaging](#messaging)
