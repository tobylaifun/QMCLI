import { createHash } from "node:crypto";
import { config } from "./config.ts";

export interface User{
    name:string,
    uuid:string,
    type:string,
    auth_access_token?:string,// microsoft only?
};

export function addUser(user:User){
    const users = config.get("users") as User[];
    users.push(user);
    config.set("users",users);
};

export function removeUser(user:User){
    const users = config.get("users") as User[];
    const index = users.findIndex(u => u.uuid === user.uuid);
    if(index !== -1){
        users.splice(index,1);
        config.set("users",users);
    }
};

export function getUsers():User[]{
    return config.get("users") as User[];
};


// offline uuid generation
export function generateOfflineUUID(username: string): string {
    // 使用 Minecraft 官方离线 UUID 生成算法
    const hash = createHash('md5')
      .update(`OfflinePlayer:${username}`, 'utf8')
      .digest();
  
    // 转换为符合 UUID v3 规范的字符串
    hash[6] = (hash[6] & 0x0f) | 0x30; // Set version to 3
    hash[8] = (hash[8] & 0x3f) | 0x80; // Set variant to RFC 4122
  
    return (
      hash.subarray(0, 4).toString('hex') + '-' +
      hash.subarray(4, 6).toString('hex') + '-' +
      hash.subarray(6, 8).toString('hex') + '-' +
      hash.subarray(8, 10).toString('hex') + '-' +
      hash.subarray(10, 16).toString('hex')
    );
  };
export function checkIsValid32UnsignedUUID(uuid:string){
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
}