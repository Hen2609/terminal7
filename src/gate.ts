/*! Terminal 8 Gate
 *  This file contains the code that makes a terminal 7 gate. The gate class
 *  represents a server and it may be boarding - aka connected - or not.
 *
 *  Copyright: (c) 2020 Benny A. Daon - benny@tuzig.com
 *  License: GPLv3
 */
import { Clipboard } from '@capacitor/clipboard'
import { Storage } from '@capacitor/storage'

import { Pane } from './pane.js'
import { Failure, Session } from './session'
import { SSHSession } from './ssh_session'
import { HTTPWebRTCSession, PeerbookSession } from './webrtc_session'
import { Window } from './window.js'


const FAILED_COLOR = "red"// ashort period of time, in milli
/*
 * The gate class abstracts a host connection
 */
export class Gate {
    activeW: Window
    addr: string
    boarding: boolean
    e: Element
    id: string
    marker: number
    name: string
    pass: string | undefined
    secret: string
    session: Session
    tryWebexec: boolean
    user: string
    username: string

    constructor (props) {
        // given properties
        this.id = props.id
        // this shortcut allows cells to split without knowing t7
        this.addr = props.addr
        this.user = props.user
        this.secret = props.secret
        this.store = props.store
        this.name = (!props.name)?`${this.user}@${this.addr}`:props.name
        this.username = props.username
        this.pass = props.pass
        this.tryWebexec = props.tryWebexec || true
        this.online = props.online
        this.verified = props.verified || false
        // 
        this.windows = []
        this.boarding = false
        this.lastMsgId = 0
        // a mapping of refrence number to function called on received ack
        this.breadcrumbs = []
        this.sendStateTask  = null
        this.timeoutID = null
        this.fp = props.fp
        this.t7 = window.terminal7
        this.session = null
    }

    /*
     * Gate.open opens a gate element on the given element
     */
    open(e) {
        // create the gate element - holding the tabs, windows and tab bar
        this.e = document.createElement('div')
        this.e.className = "gate hidden"
        this.e.style.zIndex = 2
        this.e.id = `gate-${this.id}`
        e.appendChild(this.e)
        // add the tab bar
        let t = document.getElementById("gate-template")
        if (t) {
            t = t.content.cloneNode(true)
            t.querySelector(".reset").addEventListener('click', () => 
                this.reset())
            t.querySelector(".add-tab").addEventListener(
                'click', _ => this.newTab())
            t.querySelector(".search-close").addEventListener('click', _ =>  {
                this.t7.logDisplay(false)
                this.activeW.activeP.exitSearch()
                this.activeW.activeP.focus()
            })
            t.querySelector(".search-up").addEventListener('click', _ =>
                this.activeW.activeP.findPrev())

            t.querySelector(".search-down").addEventListener('click', _ => 
                this.activeW.activeP.findNext())

            t.querySelector(".rename-close").addEventListener('click', () => 
                this.e.querySelector(".rename-box").classList.add("hidden"))
            /* TODO: handle the bang
            let b = t.querySelector(".bang")
            b.addEventListener('click', (e) => {new window from active pane})
            */
            this.e.appendChild(t)
        }
        // Add the gates' signs to the home page
        let hostsE = document.getElementById(this.fp?"peerbook-hosts":"static-hosts")
        let b = document.createElement('button'),
            addr = this.addr && this.addr.substr(0, this.addr.indexOf(":"))
        b.className = "text-button"
        this.nameE = b
        this.nameE.innerHTML = this.name || this.addr
        this.updateNameE()
        hostsE.appendChild(b)
        b.gate = this
    }
    delete() {
        this.t7.gates.splice(this.id, 1)
        this.t7.storeGates()
        // remove the host from the home screen
        this.nameE.remove()
    }
    editSubmit(ev) {
        let editHost = document.getElementById("edit-host")
        this.addr = editHost.querySelector('[name="hostaddr"]').value 
        this.name = editHost.querySelector('[name="hostname"]').value
        this.username = editHost.querySelector('[name="username"]').value
        this.nameE.innerHTML = this.name || this.addr
        this.t7.storeGates()
        this.t7.clear()
    }
    /*
     * edit start the edit-host user-assitance
     */
    edit() {
        var editHost
        if (typeof(this.fp) == "string") {
            if (this.verified) {
                this.notify("Got peer from \uD83D\uDCD6, connect only")
                return
            }
            editHost = document.getElementById("edit-unverified-pbhost")
            editHost.querySelector("a").setAttribute("href",
                "https://"+ this.t7.conf.net.peerbook)
        } else {
            editHost = document.getElementById("edit-host")
            editHost.querySelector('[name="hostaddr"]').value = this.addr
            editHost.querySelector('[name="hostname"]').value = this.name
            editHost.querySelector('[name="username"]').value = this.username
        }
        editHost.gate = this
        editHost.classList.remove("hidden")
    }
    focus() {
        this.t7.logDisplay(false)
        // hide the current focused gate
        document.getElementById("home-button").classList.remove("on")
        document.querySelectorAll(".pane-buttons").forEach(
            e => e.classList.remove("off"))
        let activeG = this.t7.activeG
        if (activeG) {
            activeG.e.classList.add("hidden")
        }
        this.t7.activeG = this
        this.e.classList.remove("hidden")
        this.e.querySelectorAll(".window").forEach(w => w.classList.add("hidden"))
        this.activeW.focus()
        this.storeState()
    }
    // stops all communication 
    stopBoarding() {
        this.boarding = false
    }
    setIndicatorColor(color) {
            this.e.querySelector(".tabbar-names").style.setProperty(
                "--indicator-color", color)
    }
    /*
     * onSessionState(state) is called when the connection
     * state changes.
     */
    onSessionState(state: RTState, failure: Failure) {
        this.t7.log(`updating ${this.name} state to ${state}`)
        if (state == "connected") {
            this.notify("Connected")
            this.t7.logDisplay(false)
            this.setIndicatorColor("unset")
            var m = this.t7.e.querySelector(".disconnect")
            if (m != null)
                m.remove()
            // show help for first timer
            Storage.get({key: "first_gate"}).then(v => {
                if (v.value != "1") {
                    this.t7.run(this.t7.toggleHelp, 1000)
                    Storage.set({key: "first_gate", value: "1"}) 
                }
            })
            this.session.getPayload().then(layout => this.setLayout(layout))
        } else if (state == "disconnected") {
            // TODO: add warn class
            this.lastDisconnect = Date.now()
            // TODO: start the rain
            this.setIndicatorColor(FAILED_COLOR)
        } else if (state == "failed")  {
            this.handleFailure(failure)
        }
    }
    // handle connection failures
    handleFailure(failure: Failure) {
        this.t7.log(failure)

        this.session = null

        if (!this.boarding)
            return
        if (failure == Failure.WrongPassword) {
            this.notify("Wrong password, please try again")
            this.pass = null
            this.connect()
            return
        }
        if (failure == Failure.Unauthorized) {
            this.copyFingerprint()
            return
        }
        if (failure == Failure.BadMarker) {
            this.notify("Session restore failed, trying a fresh session")
            this.clear()
            this.connect()
            return
        }
        if (failure == Failure.TimedOut) {
            if ((!this.fp) && this.tryWebexec) {
                this.notify("Timed out, trying SSH...")
                this.tryWebexec = false
                this.connect()
                return
            }
        }
        if (failure == Failure.BadRemoteDescription) {
            this.notify("Session signalling failed, please try again")
        }
        if (failure == Failure.NotImplemented)
            this.notify("FAILED: not implemented yet")
        if (!failure)
            this.notify("Connection FAILED")
        this.t7.onDisconnect(this)
    }
    /*
     * connect connects to the gate
     */
    async connect(marker=-1) {
        // do nothing when the network is down
        if (!this.t7.netStatus || !this.t7.netStatus.connected)
            return
        // if we're already boarding, just focus
        if (this.session) {
            // TODO: check session's status
            this.t7.log("already connected")
            if (!this.windows || (this.windows.length == 0))
                this.activeW = this.addWindow("", true)
            else
                this.focus()
            return
        }
        this.boarding = true
        // TODO add the port
        if (!this.pass && !this.fp && !this.tryWebexec) {
            this.askPass()
        } else
            this.completeConnect()
    }

    notify(message) {    
        this.t7.notify(`${this.name}: ${message}`)
    }
    /*
     * returns an array of panes
     */
    panes() {
        var r = []
        this.t7.cells.forEach(c => {
            if (c instanceof Pane && (c.gate == this))
                r.push(c)
        })
        return r
    }
    // reset reset's a gate connection by disengaging and reconnecting
    reset() {
        this.disengage().then(() => {
            this.t7.run(() =>  {
                this.connect()
            }, 100)
        }).catch(() => this.connect())
                
    }
    async loseState () {
        const fp = await this.t7.getFingerprint(),
              rc = `bash -c "$(curl -sL https://get.webexec.sh)"
echo "${fp}" >> ~/.config/webexec/authorized_fingerprints
`
        let e = document.getElementById("lose-state-template")
        e = e.content.cloneNode(true)

        e.querySelector("pre").innerText = rc
        e.querySelector(".continue").addEventListener('click', evt => {
            this.t7.e.querySelector('.lose-state').remove()
            this.clear()
            this.activeW = this.addWindow("", true)
            this.focus()
        })
        e.querySelector(".copy").addEventListener('click', evt => {
            this.t7.e.querySelector('.lose-state').remove()
            Clipboard.write( {string: rc })
            this.tryWebexec = true
            this.clear()
            this.activeW = this.addWindow("", true)
            this.focus()
        })
        e.querySelector(".close").addEventListener('click', evt => {
            this.t7.e.querySelector('.lose-state').remove()
            this.clear()
            this.t7.goHome()
        })
        this.t7.e.appendChild(e)
    }
    setLayout(state: object) {
        const winLen = this.windows.length
        // got an empty state
        if ((state == null) || !(state.windows instanceof Array) || (state.windows.length == 0)) {
            // create the first window and pane
            this.t7.log("Fresh state, creating the first pane")
            if (winLen > 0)
                // TODO: find a way to identify state lost
                this.t7.log("this.loseState()")
            else
                this.activeW = this.addWindow("", true)
        } else if (winLen > 0) {
            // TODO: validate the current layout is like the state
            this.t7.log("Restoring with marker, opening channel")
            this.panes().forEach(p => {
                if (p.d)
                    p.openChannel({id: p.d.id})
            })
        } else {
            this.t7.log("Setting layout: ", state)
            this.clear()
            state.windows.forEach(w =>  {
                let win = this.addWindow(w.name)
                if (w.active) 
                    this.activeW = win
                win.restoreLayout(w.layout)
            })
        }

        if (!this.activeW)
            this.activeW = this.windows[0]
        this.focus()
    }
    /*
     * Adds a window, opens it and returns it
     */
    addWindow(name, createPane) {
        this.t7.log(`adding Window: ${name}`)
        let id = this.windows.length
        let w = new Window({name:name, gate: this, id: id})
        this.windows.push(w)
        if (this.windows.length >= this.t7.conf.ui.max_tabs)
            this.e.querySelector(".add-tab").classList.add("off")
        w.open(this.e.querySelector(".windows-container"))
        if (createPane) {
            let paneProps = {sx: 1.0, sy: 1.0,
                             xoff: 0, yoff: 0,
                             w: w,
                             gate: this},
                layout = w.addLayout("TBD", paneProps)
            w.activeP = layout.addPane(paneProps)
        }
        return w
    }
    /*
     * clear clears the gates memory and display
     */
    clear() {
        this.t7.log("Clearing gate")
        this.e.querySelector(".tabbar-names").innerHTML = ""
        this.e.querySelectorAll(".window").forEach(e => e.remove())
        this.e.querySelectorAll(".modal").forEach(e => e.classList.add("hidden"))
        if (this.activeW && this.activeW.activeP.zoomed)
            this.activeW.activeP.toggleZoom()
        this.windows = []
        this.breadcrumbs = []
        this.msgs = {}
    }
    /*
     * dump dumps the host to a state object
     * */
    dump() {
        var wins = []
        this.windows.forEach((w, i) => {
            let win = {
                name: w.name,
                layout: w.dump()
            }
            if (w == this.activeW)
                win.active = true
            wins.push(win)
        })
        return { windows: wins }
    }
    storeState() {
        const dump = this.dump()
        var lastState = {windows: dump.windows}

        if (this.fp)
            lastState.fp = this.fp
        lastState.name = this.name
        Storage.set({key: "last_state",
                     value: JSON.stringify(lastState)})
    }

    sendState() {
        if (this.sendStateTask != null)
            return

        this.storeState()
        // send the state only when all panes have a channel
        if (this.session && (this.panes().every(p => p.d != null)))
           this.sendStateTask = setTimeout(() => {
               this.sendStateTask = null
               this.session.setPayload(this.dump()).then(() => {
                    if ((this.windows.length == 0) && (this.session != null)) {
                        this.t7.log("Closing gate after updating to empty state")
                        this.session.close().then(() => {
                            this.session = null
                            this.boarding = false
                        })
                    }
               })
            }, 100)
    }
    onPaneConnected(pane) {
        // hide notifications
        this.t7.clear()
        //enable search
        document.querySelectorAll(".pane-buttons").forEach(
            e => e.classList.remove("off"))
    }
    goBack() {
        var w = this.breadcrumbs.pop()
        this.breadcrumbs = this.breadcrumbs.filter(x => x != w)
        if (this.windows.length == 0) {
            this.stopBoarding()
            this.clear()
            this.t7.goHome()
        }
        else
            if (this.breadcrumbs.length > 0)
                this.breadcrumbs.pop().focus()
            else
                this.windows[0].focus()
    }
    showResetHost() {
        let e = document.getElementById("reset-host"),
            addr = this.addr.substr(0, this.addr.indexOf(":"))

        document.getElementById("rh-address").innerHTML = addr
        document.getElementById("rh-name").innerHTML = this.name
        e.classList.remove("hidden")
    }
    fit() {
        this.windows.forEach(w => w.fit())
    }
    /*
     * disengage orderly disengages from the gate's connection.
     * It first sends a mark request and on it's ack store the restore marker
     * and closes the peer connection.
     */
    disengage() {
        return new Promise((resolve, reject) => { 
            this.t7.log(`disengaging. boarding is ${this.boarding}`)
            if (!this.session) {
                reject("session is null")
                return
            }
            return this.session.disconnect().then(marker => {
                this.session = null
                this.marker = marker
                this.notify("Disconnected")
                resolve()
            }).catch(() => {
                reject("session does not support disconnect")
            })
        })
    }
    closeActivePane() {
        this.activeW.activeP.close()
    }
    newTab() {
        if (this.windows.length < this.t7.conf.ui.max_tabs) {
            let w = this.addWindow("", true)
            this.breadcrumbs.push(w)
            w.focus()
        }
    }
    updateNameE() {
        this.nameE.innerHTML = this.name
        if (!this.fp) {
            // there's nothing more to update for static hosts
            return
        }
        if (this.verified)
            this.nameE.classList.remove("unverified")
        else
            this.nameE.classList.add("unverified")
        if (this.online)
            this.nameE.classList.remove("offline")
        else
            this.nameE.classList.add("offline")
    }
    async copyFingerprint() {
        const addr = this.addr.substr(0, this.addr.indexOf(":")),
              fp = await this.t7.getFingerprint(),
              cmd = `echo "${fp}" >> ~/.config/webexec/authorized_fingerprints`,
              e = document.getElementById("copy-fingerprint-template")
                          .content.cloneNode(true)
        e.querySelector('pre').innerText = cmd
        e.querySelector('.ct-address').innerHTML = addr
        e.querySelector('.ct-name').innerHTML = this.name
        e.querySelector(".copy").addEventListener('click', ev => {
            this.t7.e.querySelector('.copy-fingerprint').remove()
            Clipboard.write(
                {string: cmd})
            this.t7.notify("Command copied to the clipboard")
            if (Capacitor.getPlatform() != "web") {
                this.tryWebexec = false
                this.connect()
            }
        })
        e.querySelector(".close").addEventListener('click',  ev =>  {
            this.t7.e.querySelector('.copy-fingerprint').remove()
            this.clear()
            this.t7.goHome()
        })
        this.t7.e.appendChild(e)
    }
    askPass() {
        const hideModal = evt => evt.target.closest(".modal").classList.toggle("hidden")
        const e = document.getElementById("askpass")

        if (!e) {
            // for debug
            this.completeConnect()
            return
        }
        e.querySelector("h1").innerText = `${this.username}@${this.name}`
        e.classList.remove("hidden")
        e.querySelector("form").onsubmit = evt => {
            hideModal(evt)
            this.pass = evt.target.querySelector('[name="pass"]').value
            evt.target.querySelector('[name="pass"]').value = ""
            this.session = null
            this.completeConnect()
            evt.stopPropagation()
            evt.preventDefault()
        }
        e.querySelector(".close").onclick = evt => {
            hideModal(evt)
            this.stopBoarding()
            this.tryWebexec = true
        }
        e.querySelector('[name="pass"]').focus()
    }
    completeConnect(): void {
        if (this.session == null)
            if (this.fp) {
                this.notify("&#127884 PeerBook")
                this.session = new PeerbookSession(this.fp)
            }
            else {
                if (this.tryWebexec) {
                    this.notify("&#127884 webexec server")
                    this.session = new HTTPWebRTCSession(this.fp, this.addr)
                } else {
                    this.notify("Starting SSH session")
                    this.session = new SSHSession(
                        this.addr, this.username, this.pass)
                    // next time go back to trying webexec
                    this.tryWebexec = true
                }
            }
        this.session.onStateChange = (state, failure?) => this.onSessionState(state, failure)
        this.session.onPayloadUpdate = layout => {
            this.notify("TBD: update new layout")
            this.t7.log("TBD: update layout", layout)
        }
        this.t7.log("opening session")
        this.session.connect(this.marker)
    }
}
