import BN from 'bignumber.js';
import { fixed, loanFee, web3 } from '../../lib/config';
import { Table } from 'console-table-printer';
import { dfRouter, getMooniSwap, lkRouter, multicall, shRouter, suRouter, un2Router, un3Quoter } from '../../lib/contracts';
import { Multicall, Token } from '../../lib/types';
import { getPriceOnUniV2 } from '../../lib/uniswap/v2/getCalldata';
import { getPriceOnUniV3 } from '../../lib/uniswap/v3/getCalldata';
import { getPriceOnOracle, toPrintable } from '../../lib/utils';
import TOKEN from '../../config/super_short.json';

export const DEX = [
    'UniSwapV3',
    'UniSwapV2',
    'SushiSwap',
    'ShibaSwap',
    'DefiSwap',
    'LinkSwap'
]
/**
 * Calculate dexes quote.
 * @param amountIn Input amount of token.
 * @param tokenIn Input token address.
 * @param tokenOut Output token address.
 * @returns Array of quotes.
 */
export const getAllQuotes = async (amountIn: BN, tokenIn: string, tokenOut: string) => {
    const calls = [];
    const un3 = getPriceOnUniV3(amountIn, tokenIn, tokenOut);
    const un2 = getPriceOnUniV2(amountIn, tokenIn, tokenOut, un2Router);
    const su = getPriceOnUniV2(amountIn, tokenIn, tokenOut, suRouter);
    const sh = getPriceOnUniV2(amountIn, tokenIn, tokenOut, shRouter);
    const df = getPriceOnUniV2(amountIn, tokenIn, tokenOut, dfRouter);
    const lk = getPriceOnUniV2(amountIn, tokenIn, tokenOut, lkRouter);
 
    calls.push(
        [un3Quoter.options.address, un3],
        [un2Router.options.address, un2],
        [suRouter.options.address, su],
        [shRouter.options.address, sh],
        [dfRouter.options.address, df],
        [lkRouter.options.address, lk]
    );

    const result: Multicall = await multicall.methods.tryAggregate(false, calls).call();
    const uni3Quote = result[0].success ? new BN(web3.eth.abi.decodeParameter('uint256', result[0].returnData) as any) : new BN(-Infinity);
    const uni2Quote = result[1].success ? new BN(web3.eth.abi.decodeParameter('uint256[]', result[1].returnData)[1] as any) : new BN(-Infinity);
    const suQuote = result[2].success ? new BN(web3.eth.abi.decodeParameter('uint256[]', result[2].returnData)[1] as any) : new BN(-Infinity);
    const shQuote = result[3].success ? new BN(web3.eth.abi.decodeParameter('uint256[]', result[3].returnData)[1] as any) : new BN(-Infinity);
    const dfQuote = result[4].success ? new BN(web3.eth.abi.decodeParameter('uint256[]', result[4].returnData)[1] as any) : new BN(-Infinity);
    const lkQuote = result[5].success ? new BN(web3.eth.abi.decodeParameter('uint256[]', result[5].returnData)[1] as any) : new BN(-Infinity);
    return [uni3Quote, uni2Quote, suQuote, shQuote, dfQuote, lkQuote]
}
/**
 * Calculate and display the best profit path.
 * @param amountIn Start amount to trade.
 * @param tokenPath Array of tokens to trade.
 * @returns Return the best profit.
 */
export const calculateProfit = async (amountIn: BN, tokenPath: Token[]) => {
    console.log(tokenPath.map(t => t.symbol).join(' -> ') + ' -> ' + tokenPath[0].symbol);
    const table = new Table();
    const maxAmountOut: BN[] = [amountIn,];
    const amountOut: BN[][] = [];
    const [a, b] = new BN(loanFee).toFraction();
    const feeAmount = amountIn.times(a).idiv(b);
    
    for (let i = 0; i < tokenPath.length; i++) {
        let next = (i + 1) % tokenPath.length;
        let dexName: string;
        if (!maxAmountOut[i].isFinite()) return{};
        amountOut[i] = await getAllQuotes(maxAmountOut[i], tokenPath[i].address, tokenPath[next].address);
        maxAmountOut[i + 1] = BN.max(...amountOut[i]);
        let amountInPrint: string = toPrintable(maxAmountOut[i], tokenPath[i].decimals, fixed);
        let maxAmountPrint: string = toPrintable(maxAmountOut[i + 1], tokenPath[next].decimals, fixed);
        for (let j = 0; j < amountOut[i].length; j++) {
            if (maxAmountOut[i + 1].eq(amountOut[i][j])) {
                dexName = DEX[j];
            }
        }
        table.addRow({
            'Input Token': `${amountInPrint} ${tokenPath[i].symbol}`,
            [dexName]: `${maxAmountPrint} ${tokenPath[next].symbol}`,
        });
    }
    const price = await getPriceOnOracle(tokenPath[0], TOKEN.USDT);
    const profit = maxAmountOut[tokenPath.length].minus(maxAmountOut[0]).minus(feeAmount);
    const profitUSD = profit.times(price); 
    if (profit.isFinite()) {
        table.printTable();
        console.log(
            'Input:',
            toPrintable(amountIn, tokenPath[0].decimals, fixed),
            tokenPath[0].symbol,
            '\tEstimate profit:',
            profit.gt(0) ?
                profit.div(new BN(10).pow(tokenPath[0].decimals)).toFixed(fixed).green :
                profit.div(new BN(10).pow(tokenPath[0].decimals)).toFixed(fixed).red,
            tokenPath[0].symbol,
            '($',
            profitUSD.gt(0) ?
                profitUSD.div(new BN(10).pow(tokenPath[0].decimals)).toFixed(fixed).green :
                profitUSD.div(new BN(10).pow(tokenPath[0].decimals)).toFixed(fixed).red,
            ')'
        );
    }
    return { profitUSD };
}