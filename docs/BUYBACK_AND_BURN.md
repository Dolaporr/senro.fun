# Nush treasury, buyback and burn

Agreed on 2026-11-22: every launch through Nush pays **0.01 SOL**, and **25%** of each coin's Pump creator
fees go to the Nush treasury (the creator keeps 75%). Both are set inside the launch transaction itself, and
the launch relay refuses any launch that pays less or pays anyone else.

## Where the money goes

| Source | Lands in | How |
| --- | --- | --- |
| Launch fee, 0.01 SOL | Treasury wallet | Paid in the launch transaction. |
| 25% of creator fees | Treasury's share in each coin's Pump fee-sharing config | Collected when fees are distributed on Pump (anyone can trigger it). |

The treasury address is public: it is shown in every launch review and in the Netlify setting
`VITE_NUSH_TREASURY`.

## Weekly buyback and burn (once NUSH is live)

Not automated yet: NUSH does not exist yet, and an automated swap needs its pool address and a reviewed
slippage limit. Until then, run it by hand once a week:

1. Distribute pending creator fees for Nush coins on Pump so the treasury's share arrives.
2. Note the treasury SOL balance. Keep about 0.05 SOL for transaction fees.
3. Swap the rest for NUSH on its pool, from the treasury wallet, with slippage of 1% or less.
4. Burn the NUSH received with the SPL token burn instruction (in Phantom: the token, then Burn), or send it
   to a burn address that no one controls.
5. Post both transaction links (the swap and the burn) where holders can see them.

## Before automating

- NUSH mint and pool address fixed.
- A slippage cap and a maximum size per buyback agreed.
- Run by a dedicated key with only the treasury's permissions, reviewed like any other code here.
