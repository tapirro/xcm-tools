import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PolkadotApi } from '../api/PolkadotApi'
import { AMOUNT_ALL } from '../constants'
import { getTransferableAmountInternal } from '../transfer'
import type { TBatchedTransferOptions, TTransferBaseOptions } from '../types'
import { BatchMode } from '../types'
import { createTransferOrSwap } from '../utils'
import BatchTransactionManager from './BatchTransactionManager'
import type { GeneralBuilder } from './Builder'

vi.mock('../utils')
vi.mock('../transfer')

const mockApi = {
  init: vi.fn(),
  getApi: vi.fn(),
  callBatchMethod: vi.fn()
} as unknown as PolkadotApi<unknown, unknown, unknown>

const createBuilder = () => {
  const builder = {
    currency: vi.fn(() => builder),
    createTxFactory: vi.fn(() => vi.fn())
  }
  return builder as unknown as GeneralBuilder<
    unknown,
    unknown,
    unknown,
    TTransferBaseOptions<unknown, unknown, unknown>
  >
}

const createTransferOptions = (
  overrides: Partial<TBatchedTransferOptions<unknown, unknown, unknown>> = {}
): TBatchedTransferOptions<unknown, unknown, unknown> => ({
  from: 'Acala',
  api: mockApi,
  to: 'Hydration',
  currency: { symbol: 'ACA', amount: 100 },
  recipient: 'address',
  builder: createBuilder(),
  ...overrides
})

describe('BatchTransactionManager', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('addTransaction', () => {
    it('adds a transaction to the manager', () => {
      const manager = new BatchTransactionManager()
      expect(manager.isEmpty()).toBe(true)
      manager.addTransaction(createTransferOptions())
      expect(manager.isEmpty()).toBe(false)
    })
  })

  describe('isEmpty', () => {
    it('returns true when no transactions have been added', () => {
      const manager = new BatchTransactionManager()
      expect(manager.isEmpty()).toBe(true)
    })

    it('returns false when transactions are present', () => {
      const manager = new BatchTransactionManager()
      manager.addTransaction(createTransferOptions())
      expect(manager.isEmpty()).toBe(false)
    })
  })

  describe('buildBatch', () => {
    it('throws an error if there are no transactions', async () => {
      const manager = new BatchTransactionManager()
      await expect(
        manager.buildBatch(mockApi, 'Acala', { mode: BatchMode.BATCH_ALL })
      ).rejects.toThrow('No transactions to batch.')
    })

    it('calls sendTransaction for each added transaction and batches them with batchAll', async () => {
      const manager = new BatchTransactionManager()
      manager.addTransaction(createTransferOptions())
      manager.addTransaction(createTransferOptions())
      vi.mocked(createTransferOrSwap).mockResolvedValue({ hash: 'hash' })

      await manager.buildBatch(mockApi, 'Acala', { mode: BatchMode.BATCH_ALL })
      expect(createTransferOrSwap).toHaveBeenCalledTimes(2)
    })

    it('uses batch when BATCH mode is selected', async () => {
      const spy = vi.spyOn(mockApi, 'callBatchMethod')
      const manager = new BatchTransactionManager()
      manager.addTransaction(createTransferOptions())
      vi.mocked(createTransferOrSwap).mockResolvedValue({ hash: 'hash' })

      await manager.buildBatch(mockApi, 'Acala', { mode: BatchMode.BATCH })

      expect(spy).toHaveBeenCalled()
    })

    it('uses batchAll when BATCH_ALL mode is selected', async () => {
      const manager = new BatchTransactionManager()
      manager.addTransaction(createTransferOptions())
      vi.mocked(createTransferOrSwap).mockResolvedValue({ hash: 'hash' })

      await manager.buildBatch(mockApi, 'Acala', { mode: BatchMode.BATCH_ALL })

      expect(createTransferOrSwap).toHaveBeenCalled()
    })

    it('should fail if different origins are used', async () => {
      const manager = new BatchTransactionManager()
      manager.addTransaction(createTransferOptions())
      manager.addTransaction(createTransferOptions({ from: 'Karura' }))
      vi.mocked(createTransferOrSwap).mockResolvedValue({ hash: 'hash' })

      await expect(
        manager.buildBatch(mockApi, 'Acala', { mode: BatchMode.BATCH_ALL })
      ).rejects.toThrow('All transactions must have the same origin.')
    })

    it('throws BatchValidationError when two ALL transfers for the same asset and sender are batched', async () => {
      const manager = new BatchTransactionManager()
      manager.addTransaction(
        createTransferOptions({
          sender: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
          currency: { symbol: 'ACA', amount: AMOUNT_ALL }
        })
      )
      manager.addTransaction(
        createTransferOptions({
          sender: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
          currency: { symbol: 'ACA', amount: AMOUNT_ALL }
        })
      )

      await expect(
        manager.buildBatch(mockApi, 'Acala', { mode: BatchMode.BATCH_ALL })
      ).rejects.toThrow('Cannot batch multiple "ALL" transfers for the same asset.')
    })

    it('deducts explicit sibling transfer amounts of the same asset from an ALL transfer in the batch', async () => {
      const manager = new BatchTransactionManager()
      manager.addTransaction(
        createTransferOptions({
          sender: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
          currency: { symbol: 'ACA', amount: 300n }
        })
      )
      manager.addTransaction(
        createTransferOptions({
          sender: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
          currency: { symbol: 'ACA', amount: AMOUNT_ALL }
        })
      )
      vi.mocked(getTransferableAmountInternal).mockResolvedValue(1000n)
      vi.mocked(createTransferOrSwap).mockResolvedValue({ hash: 'hash' })

      await manager.buildBatch(mockApi, 'Acala', { mode: BatchMode.BATCH_ALL })

      expect(createTransferOrSwap).toHaveBeenCalledTimes(2)
      expect(vi.mocked(createTransferOrSwap).mock.calls[1][0].currency).toEqual({
        symbol: 'ACA',
        amount: 700n
      })
    })
  })
})
