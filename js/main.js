'use strict';

var isChannelReady = false;
var isInitiator = false;
var isStarted = false;
var localStream;
var pc;
var remoteStream;
var turnReady;
var SIGNALING_SERVER = '190.254.213.124';
var codec_selector = document.getElementById('codec_selector');
var room_name = document.getElementById('room_name');
var localAudio = document.getElementById('localAudio');
var remoteAudio = document.getElementById('remoteAudio');
var show_net_info_btn = document.getElementById('show_net_info_btn');
show_net_info_btn.disabled = true;
show_net_info_btn.onclick = showNetInfo;
var active_codec = document.getElementById('active_codec');
var peer_info = document.getElementById('peer_info');
var senderStatsDiv = document.querySelector('div#senderStats');
var receiverStatsDiv = document.querySelector('div#receiverStats');

// Configuración de los recursos a usar.
var sdpConstraints = {
	offerToReceiveAudio: true,
	offerToReceiveVideo: false
};
// Restricciones del stream a obtener por medio de getUserMedia().
var constraints = {
	video: false,
	audio: true
};
var room = prompt('Ingrese el nombre de la sala a la que desee entrar:','Sala 1');
room_name.innerHTML = 'Sala: ' + room;
var codec_selected = codec_selector.options[codec_selector.selectedIndex].value; // Obtener el nombre del codec a usar.
codec_selector.onchange = codecSelection;
var socket = io.connect(SIGNALING_SERVER);

/***** Configuración Websockets *****/

if (room !== '') {
	socket.emit('create or join', room);
	console.log('Attempted to create or  join room', room);
}

socket.on('created', function(room) {
	console.log('Created room ' + room);
	isInitiator = true;
});

socket.on('full', function(room) {
	console.log('Room ' + room + ' is full');
});

socket.on('join', function (room){
	console.log('Another peer made a request to join room ' + room);
	console.log('This peer is the initiator of room ' + room + '!');
	isChannelReady = true;
});

socket.on('joined', function(room) {
	console.log('joined: ' + room);
	isChannelReady = true;
});

socket.on('log', function(array) {
	console.log.apply(console, array);
});

/***** Funciones Websockets *****/

/**
* Función para enviar un mensaje al servidor web.
* @param message 
*/
function sendMessage(message) {
	console.log('Client sending message: ', message);
	socket.emit('message', message, room);
}

/**
* Función para recibir mensajes. Los mensajes pueden ser de 5 clases.
* 1.got user media: Marca la obtención del stream de datos del emisor del mensaje.
* 2.offer: Inicia la comunicación entre pares.
* 3.answer: Establecen la comunicacion con entre pares. Obtiene la informacion de
*           contacto del mensaje y la configura en la descripcion remota.
* 4.candidate: Establece un candidato remoto ICE apartir del mensaje.
* 5.bye: Marca el final de la comunicación del par.
* @param message
*/
socket.on('message', function(message) {
	console.log('Client received message:', message);
	if (message === 'got user media') {
		maybeStart();
	}
	else if (message.type === 'offer') {
		if (!isInitiator && !isStarted) {
			maybeStart();
		}
		pc.setRemoteDescription(message);
		doAnswer();
	}
	else if (message.type === 'answer' && isStarted) {
		pc.setRemoteDescription(message);
	}
	else if (message.type === 'candidate' && isStarted) {
		var candidate = new RTCIceCandidate({
			sdpMLineIndex: message.label,
			candidate: message.candidate
		});
		pc.addIceCandidate(candidate);
	}
	else if (message === 'bye' && isStarted) {
		handleRemoteHangup();
	}
});

/***** Funciones *****/

/**
* Función para obtener el nombre del codec seleccionado en la inferfaz gráfica.
*/
function codecSelection() {
	codec_selected = codec_selector.options[codec_selector.selectedIndex].value;
}

/**
* Función para mostrar la información de red proveida por la interfaz RTCStatsReport,
* la cual ofrece datos estadisticos sobre las conexiones RTCPeerConnection. (RTCPeerConnection.getStats())
* Además muestra el codec activo en RTCPeerConnection, y la direccion ip y puerto del par al que está conectado.
*/
function showNetInfo() {
	console.log('local sdp: ',pc.localDescription.sdp);
	console.log('remote sdp: ',pc.remoteDescription.sdp);
	var a_codec = getCodec(pc.localDescription.sdp); // Obtiene el codec del sdp local de RTCPeerConnection.
	active_codec.innerHTML = 'Codec activo: ' + a_codec; 
	
	// Visualización de datos estadisticos cada 1000 mseg.
	setInterval(function() {
		if(pc) {
			pc.getStats(null)
			.then(function(results) {
				var statsString = dumpStats(results);
				receiverStatsDiv.innerHTML = '<h2>Peer connection stats</h2>' + statsString;
				
				// figure out the peer's ip
				var activeCandidatePair = null;
				var remoteCandidate = null;
				
				// Search for the candidate pair, spec-way first.
				results.forEach(function(report) {
					if (report.type === 'transport') {
						activeCandidatePair = results.get(report.selectedCandidatePairId);
					}
				});
				// Fallback for Firefox and Chrome legacy stats.
				if (!activeCandidatePair) {
					results.forEach(function(report) {
						if (report.type === 'candidate-pair' && report.selected ||
						report.type === 'googCandidatePair' &&
						report.googActiveConnection === 'true') {
							activeCandidatePair = report;
						}
					});
				}
				if (activeCandidatePair && activeCandidatePair.remoteCandidateId) {
					remoteCandidate = results.get(activeCandidatePair.remoteCandidateId);
				}
				if (remoteCandidate) {
					if (remoteCandidate.ip && remoteCandidate.port) {
						peer_info.innerHTML = 'Conectado a: ' +
						remoteCandidate.ip + ':' + remoteCandidate.port;
						} else if (remoteCandidate.ipAddress && remoteCandidate.portNumber) {
						// Fall back to old names.
						peer_info.innerHTML = 'Conectado a: ' +
						remoteCandidate.ipAddress +
						':' + remoteCandidate.portNumber;
					}
				}
				}, function(err) {
				console.log(err);
			});
			} else {
			console.log('Not connected yet');
		}
	}, 1000);
	
}

// Obtiene el stream de datos local.
navigator.mediaDevices.getUserMedia(constraints)
.then(gotStream)
.catch(function(e) {
	alert('getUserMedia() error: ' + e.name);
});

/**
* Función para obtener el stream de datos local.
* @param stream
* @return localstream
*/
function gotStream(stream) {
	console.log('Getting user media with constraints', constraints);
	console.log('Adding local stream.');
	localAudio.srcObject = stream; // Mostrar el audio local en la página.
	localStream = stream;
	sendMessage('got user media');
	if (isInitiator) {
		maybeStart();
	}
}

function maybeStart() {
	console.log('>>>>>>> maybeStart() ', isStarted, localStream, isChannelReady);
	if (!isStarted && typeof localStream !== 'undefined' && isChannelReady) {
		console.log('>>>>>> creating peer connection');
		createPeerConnection();
		pc.addStream(localStream);
		isStarted = true;
		codec_selector.disabled = true; // Deshabilitar la interfaz de selección de codec.
		show_net_info_btn.disabled = false; // Habilitar el boton de muestra de información de red.
		console.log('isInitiator', isInitiator);
		if (isInitiator) {
			doCall();
		}
	}
}

/**
* Evento que ocurre cuando el documento está por ser cerrado. Se usa para enviar un mensaje de
* despedida al servidor y cerrar el websocket.
*/
window.onbeforeunload = function() {
	hangup();
	return null;
};

function createPeerConnection() {
	try {
		pc = new RTCPeerConnection({ // Configuración servidores STUN por defecto.
			iceServers: [
				{urls:'stun:stun.l.google.com:19302'},
				{urls:'stun:stun1.l.google.com:19302'},
				{urls:'stun:stun2.l.google.com:19302'},
				{urls:'stun:stun3.l.google.com:19302'},
				{urls:'stun:stun4.l.google.com:19302'},
				{urls:'stun:stun01.sipphone.com'},
				{urls:'stun:stun.ekiga.net'},
				{urls:'stun:stun.fwdnet.net'},
				{urls:'stun:stun.ideasip.com'},
				{urls:'stun:stun.iptel.org'},
				{urls:'stun:stun.rixtelecom.se'},
				{urls:'stun:stun.schlund.de'},
				{urls:'stun:stunserver.org'},
				{urls:'stun:stun.softjoys.com'},
				{urls:'stun:stun.voiparound.com'},
				{urls:'stun:stun.voipbuster.com'},
				{urls:'stun:stun.voipstunt.com'},
				{urls:'stun:stun.voxgratia.org'},
				{urls:'stun:stun.xten.com'}
			]
		});			
		pc.onicecandidate = handleIceCandidate;
		pc.onaddstream = handleRemoteStreamAdded;
		pc.onremovestream = handleRemoteStreamRemoved;
		console.log('Created RTCPeerConnection');
		} catch (e) {
		console.log('Failed to create PeerConnection, exception: ' + e.message);
		alert('Cannot create RTCPeerConnection object.');
		return;
	}
}

function handleIceCandidate(event) {
	console.log('icecandidate event: ', event);
	if (event.candidate) {
		sendMessage({
			type: 'candidate',
			label: event.candidate.sdpMLineIndex,
			id: event.candidate.sdpMid,
			candidate: event.candidate.candidate
		});
		} else {
		console.log('End of candidates.');
	}
}

function handleRemoteStreamAdded(event) {
	console.log('Remote stream added.');
	remoteAudio.srcObject = event.stream;
	remoteStream = event.stream;
}

function handleCreateOfferError(event) {
	console.log('createOffer() error: ', event);
}

function doCall() {
	console.log('Sending offer to peer');
	pc.createOffer(setLocalAndSendMessage, handleCreateOfferError);
}

function doAnswer() {
	console.log('Sending answer to peer.');
	pc.createAnswer().then(setLocalAndSendMessage, onCreateSessionDescriptionError);
}

function setLocalAndSendMessage(sessionDescription) {
	if(isInitiator) {
		sessionDescription.sdp = setCodec(sessionDescription.sdp, codec_selected); // Establecer al codec seleccionado como predeterminado, si está disponible, sólo si es el par que inicia la comunicación.
	}
	pc.setLocalDescription(sessionDescription);
	console.log('setLocalAndSendMessage sending message', sessionDescription);
	sendMessage(sessionDescription);
}

function onCreateSessionDescriptionError(error) {
	trace('Failed to create session description: ' + error.toString());
}

function handleRemoteStreamAdded(event) {
	console.log('Remote stream added.');
	remoteAudio.srcObject = event.stream;
	remoteStream = event.stream;
}

function handleRemoteStreamRemoved(event) {
	console.log('Remote stream removed. Event: ', event);
}

function hangup() {
	console.log('Hanging up.');
	stop();
	sendMessage('bye');
	socket.disconnect();
}

function handleRemoteHangup() {
	console.log('Session terminated.');
	stop();
	isInitiator = true; // El par que queda luego de la desconexión del otro es el nuevo iniciador.
	codec_selector.disabled = false; // Habilitar la interfaz de selección de codec.
	alert('La conexión se ha terminado');
}

function stop() {
	isStarted = false;
	pc.close();
	pc = null;
}

/***** Funciones Codec *****/

/**
* Función para obtener el nombre del codec de audio en uso. (se obtiene del sdp local)
* @param sdp 
* @return codec nombre del codec segun el sdp.
*/
function getCodec(sdp) {
	var codec;
	var sdpLines = sdp.split('\r\n');
	var mLineIndex; // Almacena el índice de la linea m del sdp donde se encuentra la definicion de los codec de audio disponibles.
	for (var i = 0; i < sdpLines.length; i++) {
		if (sdpLines[i].search('m=audio') !== -1) {
			mLineIndex = i;
			break;
		}
	}
	var codecPayload = (sdpLines[mLineIndex].split(' '))[3]; // obtiene la descripción del formato de medios (media format description) del codec en uso (el cual se encuentra en la 4ta posicion de la linea m).
	for (i = 0; i < sdpLines.length; i++) {	//  Busca segun la descripción del formato de medios (media format description) obtenido la definicion del codec en uso.
		if (sdpLines[i].search('a=rtpmap:'+codecPayload) !== -1) {
			codec = (sdpLines[i].split(' '))[1];
			break;
		}
	}
	return codec;
}

/**
* Función para seleccionar el codec de audio a usar por defecto si está disponible.
* @param sdp 
* @param codec nombre del codec segun el sdp.
* @return regexpr
*/
function setCodec(sdp,codec) {
	var sdpLines = sdp.split('\r\n');
	var mLineIndex; // Almacena el índice de la linea m del sdp donde se encuentra la definicion de los codec de audio disponibles.
	var regexp_codec = getRegExprCod(codec); // Usa una expresion regular dependiendo del codec seleccionado.
	console.log('selected codec:', codec);
	// Busca el índice de la linea m del sdp donde se encuentra la definicion de los codec de audio disponibles.
	for (var i = 0; i < sdpLines.length; i++) {
		if (sdpLines[i].search('m=audio') !== -1) {
			mLineIndex = i;
			break;
		}
	}
	if (mLineIndex === null) {
		return sdp;
	}
	
	// Si el codec seleccionado está disponible lo configura como por defecto en la linea m.
	for (i = 0; i < sdpLines.length; i++) {
		if (sdpLines[i].search(codec) !== -1) {
			var codecPayload = extractSdp(sdpLines[i], regexp_codec);
			console.log('selected codec payload:', codecPayload);
			if (codecPayload) {
				sdpLines[mLineIndex] = setDefaultCodecSdp(sdpLines[mLineIndex], codecPayload);
			}
			break;
		}
	}
	
	// Elimina CN en la linea m y el sdp.
	sdpLines = removeCN(sdpLines, mLineIndex);
	
	sdp = sdpLines.join('\r\n');
	return sdp;
}

/**
* Función para obtener una extraer del sdp el codec seleccionado mediante 
* una expresion regular. Retorna por defecto la expresion regular de Opus.
* @param codec nombre del codec segun el sdp.
* @return regexpr
*/
function getRegExprCod(codec) {
	var regexpr
	switch(codec){
		case "opus/48000":
		regexpr = /:(\d+) opus\/48000/i;
		break;
		case "ISAC/16000":
		regexpr = /:(\d+) ISAC\/16000/i;
		break;
		case "ISAC/32000":
		regexpr = /:(\d+) ISAC\/32000/i;
		break;
		case "iLBC/8000":
		regexpr = /:(\d+) iLBC\/8000/i;
		break;
		case "G722/8000":
		regexpr = /:(\d+) G722\/8000/i;
		break;
		default:
		regexpr = /:(\d+) opus\/48000/i;
		break;
	}
	return regexpr;
}

/**
* Función para extraer de la linea del sdp con el codec seleccionado la
* descripción del formato de medios (media format description), al usar una
* expresion regular.
* @param sdpLine linea del sdp con el codec seleccionado.
* @param regexpcodec expresion regular del codec.
* @return result descripción del formato de medios del codec seleccionado.
*/
function extractSdp(sdpLine, regexpcodec) {
	var result = sdpLine.match(regexpcodec);
	return result && result.length === 2 ? result[1] : null;
}

/**
* Función para colocar el codec seleccionado por defecto en el sdp al 
* colocar su descripción del formato de medios (media format description)
* de primera en la linea m.
* @param mLine linea m del sdp.
* @param payload descripción del formato de medios del codec seleccionado.
* @return newLine linea m modificada.
*/
function setDefaultCodecSdp(mLine, payload) {
	var elements = mLine.split(' ');
	var newLine = [];
	var index = 0;
	for (var i = 0; i < elements.length; i++) {
		if (index === 3) { // El formato de medios empieza de la 4ta posición.
			newLine[index++] = payload; // Coloca la descripción del formato de medios del codec seleccionado de primera.
		}
		if (!(index >= 3) || elements[i] !== payload) { // Condición para evitar duplicar la descripción del formato de medios del codec seleccionado al tener en cuenta que el número de puerto en la segunda posición puede ser igual.
			newLine[index++] = elements[i];
		}
	}
	return newLine.join(' ');
}

// Strip CN from sdp before CN constraints is ready.
function removeCN(sdpLines, mLineIndex) {
	var mLineElements = sdpLines[mLineIndex].split(' ');
	// Scan from end for the convenience of removing an item.
	for (var i = sdpLines.length - 1; i >= 0; i--) {
		var payload = extractSdp(sdpLines[i], /a=rtpmap:(\d+) CN\/\d+/i);
		if (payload) {
			var cnPos = mLineElements.indexOf(payload);
			if (cnPos !== -1) {
				// Remove CN payload from m line.
				mLineElements.splice(cnPos, 1);
			}
			// Remove CN line in sdp
			sdpLines.splice(i, 1);
		}
	}
	sdpLines[mLineIndex] = mLineElements.join(' ');
	return sdpLines;
}

/***** Funciones de visualización de la información de red *****/

/**
* Función para mostrar como caracteres los datos estadisticos de la conexión (RTCPeerConnection) indicados en la interfaz RTCStatsReport.
* @param results Datos estadisticos de la conexión RTCPeerConnection.
* @return statsString Texto con los datos estadisticos de la conexión.
*/
function dumpStats(results) {
	var statsString = '';
	results.forEach(function(res) {
		statsString += '<h3>Report type=';
		statsString += res.type;
		statsString += '</h3>\n';
		statsString += 'id ' + res.id + '<br>\n';
		statsString += 'time ' + res.timestamp + '<br>\n';
		Object.keys(res).forEach(function(k) {
			if (k !== 'timestamp' && k !== 'type' && k !== 'id') {
				statsString += k + ': ' + res[k] + '<br>\n';
			}
		});
	});
	return statsString;
}

