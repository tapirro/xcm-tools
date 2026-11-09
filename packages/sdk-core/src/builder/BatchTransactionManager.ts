import { findAssetInfo, isAssetEqual, type TAssetInfo } from '@paraspell/assets'
import type { TSubstrateChain } from '@paraspell/sdk-common'

import type { PolkadotApi } from '../api/PolkadotApi'
import { AMOUNT_ALL, TX_CLIENT_TIMEOUT_MS } from '../constants'
import { BatchValidationError } from '../errors'
import type { TBatchedTransferOptions } from '../types'
import { BatchMode, type TBatchOptions } from '../types'
import { assertSubstrateOrigin, createTransferOrSwap } from '../utils'
import { normalizeAmountAll } from './normalizeAmountAll'

const resolveBatchCurrencyAsset = (
  from: TSubstrateChain,
  currency: TBatchedTransferOptions<unknown, unknown, unknown>['currency']
): TAssetInfo | null => {
  if (Array.isArray(currency)) return null
  try {
    return findAssetInfo(from, currency, null)
  } catch {
    return null
  }
}

const isSameBatchAsset = (
  from: TSubstrateChain,
  a: TBatchedTransferOptions<unknown, unknown, unknown>['currency'],
  b: TBatchedTransferOptions<unknown, unknown, unknown>['currency']
): boolean => {
  if (Array.isArray(a) || Array.isArray(b)) return false
  const assetA = resolveBatchCurrencyAsset(from, a)
  const assetB = resolveBatchCurrencyAsset(from, b)
  if (assetA && assetB) {
    return isAssetEqual(assetA, assetB)
  }
  const { amount: _amountA, ...restA } = a
  const { amount: _amountB, ...restB } = b
  return JSON.stringify(restA) === JSON.stringify(restB)
}

class BatchTransactionManager<TApi, TRes, TSigner, TCustomChain extends string = never> {
  transactionOptions: TBatchedTransferOptions<TApi, TRes, TSigner, TCustomChain>[] = []

  addTransaction(options: TBatchedTransferOptions<TApi, TRes, TSigner, TCustomChain>) {
    this.transactionOptions.push(options)
  }

  isEmpty() {
    return this.transactionOptions.length === 0
  }

  async buildBatch(
    api: PolkadotApi<TApi, TRes, TSigner, TCustomChain>,
    from: TSubstrateChain,
    options: TBatchOptions = { mode: BatchMode.BATCH_ALL }
  ): Promise<TRes> {
    await api.init(from, TX_CLIENT_TIMEOUT_MS)

    const { mode } = options
    if (this.transactionOptions.length === 0) {
      throw new BatchValidationError('No transactions to batch.')
    }

    const sameFrom = this.transactionOptions.every(tx => tx.from === from)

    if (!sameFrom) {
      throw new BatchValidationError('All transactions must have the same origin.')
    }

    for (let i = 0; i < this.transactionOptions.length; i++) {
      const first = this.transactionOptions[i]
      if (Array.isArray(first.currency) || first.currency.amount !== AMOUNT_ALL) continue
      for (let j = i + 1; j < this.transactionOptions.length; j++) {
        const second = this.transactionOptions[j]
        if (Array.isArray(second.currency) || second.currency.amount !== AMOUNT_ALL) continue
        if (
          first.sender === second.sender &&
          isSameBatchAsset(from, first.currency, second.currency)
        ) {
          throw new BatchValidationError('Cannot batch multiple "ALL" transfers for the same asset.')
        }
      }
    }

    const normalized = await Promise.all(
      this.transactionOptions.map(async opts => {
        const { builder } = opts
        return normalizeAmountAll(api, builder, opts)
      })
    )

    for (let i = 0; i < normalized.length; i++) {
      const current = normalized[i]
      if (!current.options.isAmountAll || Array.isArray(current.options.currency)) continue

      let explicitSiblingTotal = 0n
      for (let j = 0; j < normalized.length; j++) {
        if (i === j) continue
        const other = normalized[j]
        if (
          other.options.isAmountAll ||
          Array.isArray(other.options.currency) ||
          other.options.sender !== current.options.sender ||
          !isSameBatchAsset(from, current.options.currency, other.options.currency)
        ) {
          continue
        }
        explicitSiblingTotal += BigInt(other.options.currency.amount)
      }

      if (explicitSiblingTotal > 0n) {
        const resolvedTransferable = BigInt(current.options.currency.amount)
        if (resolvedTransferable <= explicitSiblingTotal) {
          throw new BatchValidationError('Batch transfer amount exceeds transferable balance.')
        }
        const remainingAmount = resolvedTransferable - explicitSiblingTotal
        current.options = {
          ...current.options,
          currency: {
            ...current.options.currency,
            amount: remainingAmount
          }
        }
      }
    }

    const txs = await Promise.all(
      normalized.map(({ options }) => {
        const { from: origin } = options
        assertSubstrateOrigin(origin)
        return createTransferOrSwap({ ...options, from: origin })
      })
    )

    return api.callBatchMethod(txs, mode)
  }
}

export default BatchTransactionManager
