import { MissingParameterError } from '@paraspell/sdk-core'
import type { Hash, WalletClient } from 'viem'

import { buildApproveToken } from './buildApproveToken'
import { getTokenBalance } from './getTokenBalance'

export const approveToken = async (
  signer: WalletClient,
  amount: bigint,
  symbol: string
): Promise<Hash> => {
  const account = signer.account ?? (await signer.getAddresses())[0]
  if (!account) {
    throw new MissingParameterError(
      'signer.account',
      'viem WalletClient must have an account configured.'
    )
  }

  let gatewayAllowance = 0n
  if (signer.transport) {
    try {
      ;({ gatewayAllowance } = await getTokenBalance(signer, symbol))
    } catch {
      gatewayAllowance = 0n
    }
  }

  if (gatewayAllowance > 0n && amount > 0n) {
    const resetTx = buildApproveToken(symbol, 0n)
    await signer.sendTransaction({
      ...resetTx,
      account,
      chain: signer.chain
    })
  }

  const tx = buildApproveToken(symbol, amount)

  return signer.sendTransaction({
    ...tx,
    account,
    chain: signer.chain
  })
}
