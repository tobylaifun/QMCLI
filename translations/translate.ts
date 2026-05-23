import transEn from "./en.json" with { type: "json" };
import transZhCN from "./zh-CN.json" with { type: "json" };

// languages
export const languages:Record<string,TransType> = { "en": transEn,"zh-CN": transZhCN };

export type TransType = Partial<typeof transEn>
export type TransKey=keyof TransType

export let activedTrans:Record<string,string>=transEn;
export function installTrans(trans:Record<string,string>){
    activedTrans=trans;
}

export function t(key: TransKey | string, ...args: unknown[]) {
    let val=activedTrans[key]||transEn[key as TransKey]||key;
    // replace $1,$2,$3 into args[0] args[1] args[3] and so on
    for(let i=0;i<args.length;i++){
        val=val.replace(`$${i+1}`, String(args[i]));
    }
    return val;
}
