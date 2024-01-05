// Called by audioContext.audioWorklet.addModule('js/audioProcessor.js')
class audioProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.port.onmessage = (event) => {
			inArray[tail] = event.data;
			numInQueue++;
			if(numInQueue == inArray.length) {
				console.warn('Queue is full!');
			}
			tail++;
			if(tail == head) {
				console.error('Tail = head ' + tail);
			}
			if(tail == inArray.length) {
				tail = 0;
			}
		};
	}

	process(inputs, outputs, parameters) {
		// Output to speakers
		if(inArray[head]) {
			if(numEmpty > 0) {
				console.log('Previous empty=' + numEmpty);
				numEmpty = 0;
			}
			let inPacket = inArray[head];
			let output = outputs[0];
			let chanOutputLeft  = output[0];
			let chanOutputRight = output[1];
			for(let i = 0; i < samplesPerPacket; i++) {
				let sample = 0;
				if(outOffset + i < inPacket.length) {
					sample = inPacket[outOffset + i];
				}
				sample = sample / 32768.0;
				chanOutputLeft[i]  =
				chanOutputRight[i] = sample;
			}
			outOffset += output[0].length;
			if(outOffset >= inPacket.length) {
				inArray[head] = null;
				head++;
				numInQueue--;
				if(head == tail && numInQueue > 0) {
					console.error('Head = tail ' + tail);
				}
				if(head == inArray.length) {
					head = 0;
				}
				outOffset = 0;
			}
		} else {
			numEmpty++;
		}

		// Input from microphone
		let energy = 0;
		if (inputs[0].length) {
			let micInput = inputs[0][1];
			let outArrayOffset = numOutPackets * samplesPerPacket;
			for(let i = 0; i < samplesPerPacket; i++) {
				let sample = micInput[i];
				sample = sample * 32768.0;
				energy += sample;
				outArray[outArrayOffset + i] = sample;
				if(sample != 0)
					allZeros = false;
			}
			// Once the array is full, send it
			if(++numOutPackets == packetsPerSend) {
				// Don't send the packets if it's complete silence (all zeros)
				if(!allZeros) {
					this.port.postMessage(outArray);
				}
				numOutPackets = 0;
				allZeros = true;
			}
		}
		return true;
	}
}

const samplesPerPacket = 128;     // Seems to be a constant set by the browser (or specification)

// Variables for playing audio
var inArray = new Array(1024);
var numInQueue = 0;
var head = 0;
var tail = 0;
var inIndex = 0;
var outOffset = 0;
var numEmpty = 0;

// Variables for processing microphone input
var allZeros = true;
var numOutPackets = 0;
var packetsPerSend = 128; // Needs to be a power of two to be compatible with audioContext.createScriptProcessor(bufferSize)
var outArray = new Int16Array(packetsPerSend * samplesPerPacket);

registerProcessor('audioProcessor', audioProcessor);
