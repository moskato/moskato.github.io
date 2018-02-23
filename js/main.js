'use strict';

//var SIGNALING_SERVER = '190.254.213.124';
var SIGNALING_SERVER = 'localhost:8080';
var CHROME = (navigator.userAgent.toString().toLowerCase().indexOf("chrome") != -1);
var isChannelReady = false;
var isInitiator = false;
var isStarted = false;
var localStream;
var remoteStream;
var pc;
var room;
var codec_selected;
var codec_last_used;
var netStatsIntervalId;
var toggle_net_statistics = false;
var mediaRecorder;
var socket = io.connect(SIGNALING_SERVER);
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
// Configuración de los servidores ICE/TURN a usar en la conexión.
var ice_turn_servers = { iceServers: [ 	{urls:'stun:stun.l.google.com:19302'},
	{urls:'stun:stun1.l.google.com:19302'},
	{urls:'stun:stun2.l.google.com:19302'},
	{urls:'stun:stun3.l.google.com:19302'},
	{urls:'stun:stun4.l.google.com:19302'}
	/*{urls:'stun:stun01.sipphone.com'},
	{urls:'stun:stun.ekiga.net'},
	{urls:'stun:stun.fwdnet.net'},
	{urls:'stun:stun.ideasip.com'},
	{urls:'stun:stun.iptel.org'},
	{urls:'stun:stun.rixtelecom.se'},
	{urls:'stun:stun.schlund.de'},
	{urls:'stun:stun.softjoys.com'},
	{urls:'stun:stun.voiparound.com'},
	{urls:'stun:stun.voipbuster.com'},
	{urls:'stun:stun.voipstunt.com'},
	{urls:'stun:stun.voxgratia.org'},
	{urls:'stun:stun.xten.com'}*/
]};
var create_rooms_div = document.getElementById('create_room_div');
var room_name = document.getElementById('room_name');
var codec_selector = document.getElementById('codec_selector');
var create_room_btn = document.getElementById('create_room_btn');
var room_list_div = document.getElementById('room_list_div');
var room_list_btns_div = document.getElementById('room_list_btns_div');
var audio_display_div = document.getElementById('audio_display_div');
var room_name_label = document.getElementById('room_name_label');
var localAudio = document.getElementById('localAudio');
var remoteAudio = document.getElementById('remoteAudio');
var exit_room_btn = document.getElementById('exit_room_btn');
exit_room_btn.onclick = exitRoom;
var cambiar_codec_prf_btn = document.getElementById('cambiar_codec_prf_btn');
var codec_selector_2 = document.getElementById('codec_selector_2');
var guardar_codec_sel_btn = document.getElementById('guardar_codec_sel_btn');
guardar_codec_sel_btn.onclick = saveSelCodec;
var show_net_info_btn = document.getElementById('show_net_info_btn');
show_net_info_btn.onclick = showNetInfo;
show_net_info_btn.disabled = true;
var net_statistics_div = document.getElementById('net_statistics_div');
var active_codec = document.getElementById('active_codec');
var peer_info = document.getElementById('peer_info');
var peer_connection_stats_div = document.querySelector('div#peer_connection_stats_div');

request_rooms_list(); // pedir la lista de cuartos creados al iniciar.

/****************************** Configuración Websockets ******************************/

/**
* Función para manejar la petición de la lista de salas activas en el servidor. Si el par está 
* buscando salas a unirse se crean botones con los que permitirle unirse a las salas recibidas.
* @param rooms lista de salas activas en el servidor.
*/
socket.on('room list', function(rooms) {
	console.log('room list arrived');
	if(!isChannelReady && !isInitiator && !isStarted) {
		create_rooms_list_btns(rooms);
	}
});

/**
* Función para manejar el informe de que el par es el creador de la sala.
* @param room nombre de la sala creada.
*/
socket.on('created', function(room) {
	console.log('Created room ' + room);
	isInitiator = true;
});

/**
	* Función para manejar el informe de que la sala a la que intenta unirse el par está llena.
	* Desactiva la interfaz gráfica de la transmision de datos y vuelve a pedir la lista de salas.
	* @param room nombre de la sala.
*/
socket.on('full', function(room) {
	console.log('Room ' + room + ' is full');
	alert('La sala especificada está llena, intente con otra o espere a que se desocupe.');
	toggle_show_divs(false);
	request_rooms_list();
});

/**
* Función para manejar el informe de que el par pidió unirse a una sala ya existente.
* @param room nombre de la sala.
*/
socket.on('join', function (room){
	console.log('Another peer made a request to join room ' + room);
	console.log('This peer is the initiator of room ' + room + '!');
	isChannelReady = true;
});

/**
* Función para manejar el informe de que el par se unió a una sala ya existente.
* @param room nombre de la sala.
*/
socket.on('joined', function(room) {
	console.log('joined: ' + room);
	isChannelReady = true;
});

/**
* Función para manejar el informe de que el par se salió de la sala especificada.
* @param room nombre de la sala.
*/
socket.on('left', function(room){
	console.log('left: ' + room);
	isChannelReady = false;
	isInitiator = false;
});

/**
* Función para registrar los mensajes del servidor en el cliente.
* @param array Registro enviado por el servidor.
*/
socket.on('log', function(array) {
	console.log.apply(console, array);
});

/**
* Función para manejar la desconexión de la conexión con el servidor. 
*/
socket.on('disconnect', function () {
	console.log('disconnected to server');
} );

/****************************** Funciones Websockets ******************************/

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
* 2.offer: Inicia la negociación de la comunicación entre pares al hacer la oferta.
* 3.answer: Establecen la comunicacion con entre pares. Obtiene la información de
*           contacto del mensaje y la configura en la descripción remota.
* 4.candidate: Establece un candidato remoto ICE a partir del mensaje.
* 5.bye: Marca el final de la comunicación del par remoto.
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

/**
* Función para pedir la lista de salas creadas en el servidor web.
*/
function request_rooms_list() {
	if(!isChannelReady && !isInitiator && !isStarted) {
		console.log('requesting room list');
		socket.emit('request room list');
	}
}

/****************************** Funciones ******************************/

/**
* Función para detener intervalos creados con setInterval.
* @param IntervalID Identificador del intervalo a detener.
*/
function stop_interval(IntervalID) {
	try {
		clearInterval(IntervalID);
	}
	catch(e)
	{
		console.log(e);
	}
}

/**
* Función para crear botones que sirven para unirse las salas especificadas en la lista de salas.
* @param rooms Lista de salas.
*/
function create_rooms_list_btns(rooms) {
	var btns2create = '';
	rooms.forEach(function(room){
		btns2create += '<button class="btn btn-outline-primary" onClick="createRoom(\''+room+'\')">'+room+'</button>';
	});
	room_list_btns_div.innerHTML = btns2create;
}

/**
* Función para habilitar/deshabilitar mostrar la interfaz gráfica de creación de salas,
* listado de salas, información transmisión de audio, y estadisticas de red.
* @param show Valor booleano que representa la interfaz grafica disponible para creacion de salas(true)/muestra de información durante la transmisión de audio(false).
*/
function toggle_show_divs(show) {
	if(show){
		create_room_btn.disabled = true;
		exit_room_btn.disabled = false;
		create_rooms_div.style.display = 'none';
		room_list_div.style.display = 'none';
		audio_display_div.style.display = 'block';
	}
	else{
		toggle_net_statistics = false;
		create_room_btn.disabled = false;
		exit_room_btn.disabled = true;
		create_rooms_div.style.display = 'block';
		room_list_div.style.display = 'block';
		audio_display_div.style.display = 'none';
		net_statistics_div.style.display = 'none';
	}
}

/**
* Función para la creación de salas en el servidor.
* @param room_n Nombre de la sala.
*/
function createRoom(room_n) {
	room = room_n;
	if (room !=='' || typeof room !== 'undefined') {
		socket.emit('create or join', room);
		console.log('Attempted to create or join room', room);
		room_name_label.innerHTML = 'Sala: ' + room;
		codec_selected = codec_selector.options[codec_selector.selectedIndex].value; // Obtener el nombre del codec a usar.
		toggle_show_divs(true);
		
		// Obtiene el stream de datos local.
		navigator.mediaDevices.getUserMedia(constraints)
		.then(gotStream)
		.catch(function(e) {
			alert('getUserMedia() error: ' + e.name);
		});
	}
}

/**
* Función para salir de la sala actual a la que se encuentra unido en el servidor.
*/
function exitRoom() {
	if(pc) {
		stop();
		sendMessage('bye');
	}
	socket.emit('leave', room);
	console.log('Attempted to leave room', room);
	room = '';
	room_name.value = '';
	toggle_show_divs(false);
	//request_rooms_list();
	stop_interval(netStatsIntervalId);
	var track = localStream.getTracks()[0];  
	track.stop(); // detiene el stream local de audio.
}

/**
* Función para guardar el codec seleccionado en el dialogo modal.
*/
function saveSelCodec() {
	codec_selected = codec_selector_2.options[codec_selector_2.selectedIndex].value;
}

/**
* Función para mostrar la información de red proveida por la interfaz RTCStatsReport,
* la cual ofrece datos estadisticos sobre las conexiones RTCPeerConnection. (RTCPeerConnection.getStats())
* Además muestra el codec activo en RTCPeerConnection, y la direccion ip y puerto del par al que está conectado.
*/
function showNetInfo() {
	
	if(toggle_net_statistics) {
		toggle_net_statistics = false;
		clearInterval(netStatsIntervalId);
		net_statistics_div.style.display = 'none';
	}
	else {
		toggle_net_statistics = true;
		net_statistics_div.style.display = 'block';
		
		
		if(pc) {
			console.log('local sdp: ',pc.localDescription.sdp);
			console.log('remote sdp: ',pc.remoteDescription.sdp);
			
			// Visualización de datos estadisticos cada 1000 mseg.
			netStatsIntervalId = setInterval(function() {
				if(isInitiator) {
					var a_codec = getCodec(pc.remoteDescription.sdp); // Obtiene el codec del sdp de RTCPeerConnection.
				}
				else {
					var a_codec = getCodec(pc.localDescription.sdp); // Obtiene el codec del sdp de RTCPeerConnection.
				}
				active_codec.value = a_codec;
				pc.getStats(null)
				.then(function(results) {
					var statsString = dumpStats(results);
					peer_connection_stats_div.innerHTML = '<h2>Peer connection stats</h2>' + statsString;
					
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
							peer_info.value = remoteCandidate.ip + ':' + remoteCandidate.port;
							} else if (remoteCandidate.ipAddress && remoteCandidate.portNumber) {
							// Fall back to old names.
							peer_info.value = remoteCandidate.ipAddress +
							':' + remoteCandidate.portNumber;
						}
					}
					}, function(err) {
					console.log(err);
				});
				
			}, 1000);
		} 
		else {
			console.log('Not connected yet');
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

/**
* Función para obtener el stream de datos local.
* @param stream
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

/**
* Función que al comprobar los requisitos previos inicia el proceso de negociación para establecer la 
* transmisión de audio al crear la conexión entre pares y añadir el stream local.
*/
function maybeStart() {
	console.log('>>>>>>> maybeStart() ', isStarted, localStream, isChannelReady);
	if (!isStarted && typeof localStream !== 'undefined' && isChannelReady) {
		console.log('>>>>>> creating peer connection');
		createPeerConnection(ice_turn_servers);
		pc.addStream(localStream);
		isStarted = true;
		cambiar_codec_prf_btn.disabled = true; // Deshabilitar la interfaz de selección de codec.
		show_net_info_btn.disabled = false; // Habilitar el boton de muestra de información de red.
		console.log('isInitiator', isInitiator);
		if (isInitiator) {
			doCall();
		}
	}
}

/**
* Función para crear objeto de la clase RTCPeerConnection e inicializarlo con los servidores de STUN/TURN a usar en
* la conexión, además de establecer los manejadores de eventos de la conexión.
* @param ICE_Config JSON que contiene la información de la dirección y autenticación de los servidores ICE/TURN a usar en la conexión.  
*/
function createPeerConnection(ICE_Config) {
	try {
		pc = new RTCPeerConnection(ICE_Config);			
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
	remoteAudio.setAttribute('autoplay','1'); // Autoreproduce el stream de audio remoto.
	remoteStream = event.stream;
	
	/****************************** Grabador de Audio ******************************/
	
	/**
	* Funciones para grabar el stream de audio remoto mediante la API de MediaRecorder (Sólo Google Chrome).	
	* El audio grabado se muestra en el elemento hmtl de audio remoto permitiendo descargarlo.
	* (Si se conecta otro par a la sala antes de descargar el archivo de la transmisión de audio previa
	*  el link de la grabación se pierde y se empieza una nueva grabación.)
	*/
	if(CHROME)
	{
		mediaRecorder = new MediaRecorder(remoteStream);
		mediaRecorder.start();
		console.log("recording of remote stream started");
		var chunks = [];
		mediaRecorder.ondataavailable = function(e) {
			chunks.push(e.data);
		}
		mediaRecorder.onstop = function(e) {
			console.log("recording of remote stream stopped");
			var mtype;
			if (codec_last_used !== null)
			{
				switch(codec_last_used){
					case "opus/48000":
					mtype = { 'type' : 'audio/opus; codecs=opus' };
					break;
					case "ISAC/16000":
					mtype = { 'type' : 'audio/isac; codecs=isac' };
					break;
					case "ISAC/32000":
					mtype = { 'type' : 'audio/isac; codecs=isac' };
					break;
					case "iLBC/8000":
					mtype = { 'type' : 'audio/iLBC; codecs=iLBC' };
					break;
					case "G722/8000":
					mtype = { 'type' : 'audio/G722; codecs=G722' };
					break;
					default:
					mtype = { 'type' : 'audio/opus; codecs=opus' };
					break;
				}
			}
			var blob = new Blob(chunks, mtype);
			chunks = [];
			var audioURL = window.URL.createObjectURL(blob);
			remoteAudio.removeAttribute('autoplay'); // Detiene la autoreproduccion del archivo de audio grabado.
			remoteAudio.src = audioURL;
		}
	}
	/****************************** Fin Grabador de Audio ******************************/
}

function handleRemoteStreamRemoved(event) {
	console.log('Remote stream removed. Event: ', event);
}

/**
* Función para cerrar la conexion entre pares en el objeto RTCPeerConnection.
*/
function stop() {
	isStarted = false;
	pc.close();
	pc = null;
}

/**
* Función para cerrar la conexión entre pares y el websocket e informar al servidor del cierre al enviar un
* mensaje de terminación de la conexión.
*/
function hangup() {
	console.log('Hanging up.');
	stop();
	sendMessage('bye');
	socket.disconnect();
}

/**
* Función que maneja la desconexión por parte del otro par de la transmisión de audio al cerrar la conexión actual
* y dejar al par listo para recibir otra conexión en la misma sala.
* (se activa al recibir un mensaje de 'bye' retransmitido por el servidor de señalización)
*/
function handleRemoteHangup() {
	console.log('Session terminated.');
	stop();
	if(CHROME) { // Detiene el grabador de audio y obtiene el codec para establecer el MimeType (sólo para Google Chrome).
		if(isInitiator) {
			var codec_last_used = getCodec(pc.remoteDescription.sdp); // Obtiene el codec del sdp de RTCPeerConnection.
		}
		else {
			var codec_last_used = getCodec(pc.localDescription.sdp); // Obtiene el codec del sdp de RTCPeerConnection.
		} 
		mediaRecorder.stop(); 
	} 
	isInitiator = true; // El par que queda luego de la desconexión del otro es el nuevo iniciador.
	if (toggle_net_statistics == true) { 
		clearInterval(netStatsIntervalId); // Detiene la obtención de datos estadisticos de la conexión.
	}
	cambiar_codec_prf_btn.disabled = false; // Habilitar la interfaz de selección de codec.
	alert('La conexión se ha terminado');
}

/****************************** Funciones Codec ******************************/

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
* @return regexpr expresion regular del codec seleccionado.
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

/****************************** Funciones de visualización de la información de red ******************************/

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
