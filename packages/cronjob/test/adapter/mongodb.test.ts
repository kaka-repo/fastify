import Fastify from 'fastify'
import { MongoClient } from 'mongodb'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fastifyCronJob } from '../../lib'
import { MongoDBAdapter, type MongoDBAdapterOptions } from '../../lib/adapter/mongodb'

const MONGODB_URI = 'mongodb://127.0.0.1:27017/?replicaSet=rs0'
const minTickMS = 32
const maxTickMS = 256
const RANDOM_GAP = (maxTickMS - minTickMS) + 3072

function createDeferredPromise (): { promise: Promise<void>, resolve: () => void, reject: () => void } {
  const promise: any = {}
  promise.promise = new Promise(function (resolve, reject) {
    promise.resolve = resolve
    promise.reject = reject
  })
  return promise
}

test('MongoDBAdapter', async function (t) {
  const client = new MongoClient(MONGODB_URI)
  await client.connect()

  const db = client.db('foobar')
  const fastify = Fastify()

  const adapterOption: MongoDBAdapterOptions = {
    db
  }
  await fastify.register(fastifyCronJob, {
    application: t.name,
    adapter: MongoDBAdapter,
    adapterOption,
    minTickMS,
    maxTickMS,
    maxExecutionMS: 8000
  })

  fastify.cronjob.on('executed', function (task) {
    ticks[task.uid]++
    if (timestamps[task.uid].length < 2) {
      timestamps[task.uid].push(task.timestamp as number)
    } else {
      timestamps[task.uid][1] = task.timestamp as number
    }

    const now = Date.now()

    if (
      (String(task.uid).includes('interval') || String(task.uid).includes('timeout')) &&
      timestamps[task.uid].length === 2
    ) {
      const expected = timestamps[task.uid][0]
      const _from = expected - RANDOM_GAP
      const _to = expected + RANDOM_GAP
      const diff = now - expected

      if (String(task.uid).includes('interval')) {
        if (ticks[task.uid] >= 2) {
          fastify.cronjob.clearInterval(task.uid as string)
          assert.equal(ticks[task.uid], 2)
          dones[task.uid]()
        } else {
          timestamps[task.uid][0] = now + task.delay
          assert.equal(ticks[task.uid], 1)
        }
      } else {
        assert.equal(ticks[task.uid], 1)
        dones[task.uid]()
      }
      assert.equal(_from < now && now < _to, true)
      assert.equal(diff < RANDOM_GAP, true)
    }
  })

  const dones: Record<string, () => void> = {}
  const timestamps: Record<string, number[]> = {}
  const ticks: Record<string, number> = {}

  const checkInterval = async function (interval: number): Promise<void> {
    const promise = createDeferredPromise()
    const uid = await fastify.cronjob.setInterval(async () => {}, interval, '' + interval)
    dones[uid] = promise.resolve
    timestamps[uid] = [Date.now() + interval]
    ticks[uid] = 0
    await promise.promise
  }

  const checkTimeout = async function (interval: number): Promise<void> {
    const promise = createDeferredPromise()
    const uid = await fastify.cronjob.setTimeout(async () => {}, interval, '' + interval)
    dones[uid] = promise.resolve
    timestamps[uid] = [Date.now() + interval]
    ticks[uid] = 0
    await promise.promise
  }

  t.after(async function () {
    await db.dropDatabase()
    await fastify.close()
    await client.close(true)
  })

  await t.test('fastify.cronjob', function (t, done) {
    assert.ok(fastify.cronjob)
    assert.equal(typeof fastify.cronjob.setTimeout, 'function')
    assert.equal(typeof fastify.cronjob.setInterval, 'function')
    assert.equal(typeof fastify.cronjob.setImmediate, 'function')
    done()
  })

  await t.test('interval', async function () {
    const promises = [
      checkInterval(384),
      checkInterval(512),
      checkInterval(640),
      checkInterval(768),
      checkInterval(778),
      checkInterval(788),
      checkInterval(789),
      checkInterval(800),
      checkInterval(801),
      checkInterval(802)
    ]
    await Promise.allSettled(promises)
  })

  await t.test('timeout', async function () {
    const promises = [
      checkTimeout(384),
      checkTimeout(512),
      checkTimeout(640),
      checkTimeout(768),
      checkTimeout(778),
      checkTimeout(788),
      checkTimeout(789),
      checkTimeout(800),
      checkTimeout(801),
      checkTimeout(802)
    ]
    await Promise.allSettled(promises)
  })
})
