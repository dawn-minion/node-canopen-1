const abortCodes = {
    0x05030000: "Toggle bit not altered",
    0x05040000: "SDO protocol timed out",
    0x05040001: "Command specifier not valid or unknown",
    0x05040002: "Invalid block size in block mode",
    0x05040003: "Invalid sequence number in block mode",
    0x05040004: "CRC error (block mode only)",
    0x05040005: "Out of memory",
    0x06010000: "Unsupported access to an object",
    0x06010001: "Attempt to read a write only object",
    0x06010002: "Attempt to write a read only object",
    0x06020000: "Object does not exist",
    0x06040041: "Object cannot be mapped to the PDO",
    0x06040042: "Number and length of object to be mapped exceeds PDO length",
    0x06040043: "General parameter incompatibility reasons",
    0x06040047: "General internal incompatibility in device",
    0x06060000: "Access failed due to hardware error",
    0x06070010: "Data type does not match: length of service parameter does not match",
    0x06070012: "Data type does not match: length of service parameter too high",
    0x06070013: "Data type does not match: length of service parameter too short",
    0x06090011: "Sub index does not exist",
    0x06090030: "Invalid value for parameter (download only).",
    0x06090031: "Value range of parameter written too high",
    0x06090032: "Value range of parameter written too low",
    0x06090036: "Maximum value is less than minimum value.",
    0x060A0023: "Resource not available: SDO connection",
    0x08000000: "General error",
    0x08000020: "Data cannot be transferred or stored to application",
    0x08000021: "Data cannot be transferred or stored to application because of local control",
    0x08000022: "Data cannot be transferred or stored to application because of present device state",
    0x08000023: "Object dictionary not present or dynamic generation fails",
    0x08000024: "No data available",
};

class SDO
{
    constructor(device)
    {
        this.device = device
        this.message = {
            id: 0x600 + this.device.deviceId,
            ext: false,
            rtr: false,
            data: Buffer.alloc(8),
        };
    }

    parse(msg)
    {
        const command = msg.data[0];
        const index = msg.data.readUInt16LE(1);

        let error = 0;
        if(command == 0x80)
            error = abortCodes[msg.data.readUInt32LE(4)];

        return [command, index, error];
    }

    upload(index, subIndex, timeout=1000)
    {
        console.log("upload", index);
        return new Promise((resolve, reject)=>{
            resolve();
        });
    }

    download(index, subIndex, data, timeout=1000)
    {
        console.log("download", index);
        return new Promise((resolve, reject)=>{
            let entry = this.device.get(index);
            if(entry == undefined)
                reject("'" + index + "' not a data object");

            if(Array.isArray(entry))
                if(entry.length != 1)
                    reject("'" + index + "' name is not unique")
                else
                    entry = entry[0];

            if(subIndex != 0)
                entry = entry[subindex];

            const timer = setTimeout(()=>{ reject("SDO protocol timed out"); }, timeout);

            this.message.data[1] = (entry.index & 0xFF);
            this.message.data[2] = (entry.index >> 8);
            this.message.data[3] = subIndex;

            const [value, size, raw] = this.device._parseRaw(entry.dataType, data)
            let bytesSent = 0;
            let toggle = 1;

            if(size <= 4)
            {
                // Expedited transfer
                this.message.data[0] = 0x23 | ((4-size) << 2);
                for(let i = 0; i < size; i++)
                    this.message.data[4+i] = raw[i];

                bytesSent = size;
            }
            else
            {
                // Segmented transfer
                this.message.data[0] = 0x21;
                this.message.data[4] = size;
                this.message.data[5] = size >> 8;
                this.message.data[6] = size >> 16;
                this.message.data[7] = size >> 24;
            }

            const callback = ([command, index, error])=>
            {
                if(command == 0x80)
                {
                    clearTimeout(timer);
                    this.device.removeListener("SDO", callback);
                    reject(error);
                }
                else if((command == (0x20 | (toggle << 4)))
                     || (command == 0x60 && index == entry.index))
                {
                    if(bytesSent < size)
                    {
                        let count = Math.min(7, (size - bytesSent));
                        for(let i = 0; i < count; i++)
                            this.message.data[i+1] = raw[i+bytesSent];

                        for(let i = count; i < 7; i++)
                            this.message.data[i+1] = 0;

                        bytesSent += count;
                        toggle ^= 1;

                        this.message.data[0] = (toggle << 4) | (7-count) << 1;
                        if(bytesSent == size)
                            this.message.data[0] |= 1;

                        this.device.channel.send(this.message);
                    }
                    else
                    {
                        clearTimeout(timer);
                        this.device.removeListener("SDO", callback);
                        entry.value = value;
                        entry.size = size;
                        entry.raw = raw;
                        resolve();
                    }
                }
            }
            this.device.on("SDO", callback);
            this.device.channel.send(this.message);
        });
    }
};

module.exports=exports=SDO;
