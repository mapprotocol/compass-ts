import { error } from "console";
import { alarm } from '../alarm/slack'

interface BridgeDataResponse {
    errno: number;
    statusCode: number;
    message: string;
    data: Bridge[];
}

interface Bridge {
    data: string;
    relay: boolean;
    receiver: string;
}

interface BridgeDataRequest {
    entrance?: string;
    affiliate?: string[];
    fromChainID: string;
    toChainID: string;
    amount: string;
    tokenInAddress: string;
    tokenOutAddress: string;
    minAmountOut: string;
    receiver: string;
    caller: string;
    entranceId: string;
}

const SuccessCode = 0; // Assuming this is defined elsewhere
const PathBridgeData = '/messageInBridgeData';
const entrance = ''; // Set default entrance

export async function requestBridgeData(domain:string, txHash:string, request: BridgeDataRequest): Promise<Bridge> {
    let affiliate = "";
    if (request.affiliate && request.affiliate.length > 0) {
        affiliate = request.affiliate
            .map((a, i) => `${i === 0 ? 'affiliate=' : '&affiliate='}${encodeURIComponent(a)}`)
            .join('');
    }

    const params = `fromChainId=${request.fromChainID}&caller=${request.caller}&toChainId=${request.toChainID}&amount=${request.amount}` +
        `&tokenInAddress=${request.tokenInAddress}&tokenOutAddress=${request.tokenOutAddress}` +
        `&minAmountOut=${request.minAmountOut}&receiver=${request.receiver}` +
        `&entranceId=${request.entranceId}&${affiliate}`;

    const url = `${domain}${PathBridgeData}?${params}`;
    console.log(`request butter bridge data url: ${url}`);

    try {
        const response = await fetch(url);
        const ret = await response.json() as BridgeDataResponse;

        if (!isUndefined(ret.statusCode) && ret.statusCode !== SuccessCode) {
            throw new ExternalRequestError(
                url,
                ret.message,
                ret.statusCode.toString()
            );
        }

        if (ret.errno !== SuccessCode) {
            throw new ExternalRequestError(
                url,
                ret.message,
                ret.errno.toString()
            );
        }

        if (!ret.data || ret.data.length === 0) {
            throw new ExternalRequestError(
                url,
                ret.message,
                ret.errno.toString(),
                new Error('Transaction data not found')
            );
        }

        console.log(`request butter bridge back data: ${ret}`);
        return ret.data[0];
    } catch (error) {
        alarm(`Sol2Evm ${txHash} filter failed ${error}, url is ${url}`)
        if (error instanceof ExternalRequestError) {
            throw error;
        }
        throw new ExternalRequestError(
            url,
            error instanceof Error ? error.message : 'Unknown error',
            undefined,
            error instanceof Error ? error : undefined
        );
    }
}

function isUndefined(value: any): value is undefined {
  return value === undefined;
}

class ExternalRequestError extends Error {
    constructor(
        public url: string,
        public message: string,
        public code?: string,
        public error?: Error
    ) {
        super(message);
        this.name = 'ExternalRequestError';
    }
}