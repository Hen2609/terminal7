/*! Terminal 7 Layout - a class that colds a layout container.
 * layout has a direction and an array of cells. layouts can be compund - 
 * a layout can contain layouts.
 *
 *  Copyright: (c) 2021 Benny A. Daon - benny@tuzig.com
 *  License: GPLv3
 */
import { Cell } from './cell'
import { Pane } from './pane'

const  ABIT                = 10

export interface SerializedLayout {
    dir: string,
    sx: number,
    sy: number,
    xoff: number,
    yoff: number,
    cells: Cell[],
    active?: boolean
}

export class Layout extends Cell {
    cells?: Cell[]
    dir: "TBD" | "topbottom" | "rightleft"
    active?: boolean
    /*
     * Layout constructor creates a `Layout` object based on a cell.
     * The new object wraps the `basedOn` cell and makes it his first son
     */
    constructor(dir, basedOn) {
        super({
            sx: basedOn.sx || 1.0, 
            sy: basedOn.sy || 1.0,
            xoff: basedOn.xoff || 0.0,
            yoff: basedOn.yoff || 0.0,
            w: basedOn.w || null,
            className: "layout",
            gate: basedOn.gate ||null})
        this.t7.log("in layout constructore")
        this.dir = dir
        // if we're based on a cell, we make it our first cell
        if (basedOn instanceof Cell) {
            this.layout = basedOn.layout
            basedOn.layout = this
            this.cells = [basedOn]
            // if we're in a layout we need replace basedOn there
            if (this.layout != null)
                this.layout.cells.splice(this.layout.cells.indexOf(basedOn), 1, this)
        }
        else
            this.cells = []
    }

    get numPanes() {
        let n = 0
        this.cells.forEach(c => 
            n += c instanceof Layout ? c.numPanes : 1
        )
        return n
    }

    fit() {
        this.cells.forEach(c => c.fit())
    }
    focus() {
        this.cells[0].focus()
    }
    /*
     * On a cell going away, resize the other elements
     */
    onClose(c: Cell) {
        if (c instanceof Pane && c.zoomed)
            c.unzoom()
        this.t7.cells.splice(this.t7.cells.indexOf(c), 1)
        // if this is the only pane in the layout, close the layout
        if (this.cells.length == 1) {
            if (this.layout != null)
                this.layout.onClose(this)
            else {
                // activate the next window
                this.w.close()
            }
            this.e.remove()
        } else {
            const i = this.cells.indexOf(c), 
                p = (i > 0)?this.cells[i-1]:this.cells[1]
            // if no peer it means we're removing the last pane in the window
            if (p === undefined) {
                this.w.close()
                return
            }
            if (this.dir == "rightleft") {
                p.sy += c.sy
                if (c.yoff < p.yoff)
                    p.yoff = c.yoff
            } else {
                p.sx += c.sx
                if (c.xoff < p.xoff)
                    p.xoff = c.xoff
            }
            p.fit()
            p.focus()
            // remove this from the layout
            this.cells.splice(i, 1)
            this.w.updateDivideButtons()
        }
    }
    /*
     * Replace an old cell with a new cell, used when a pane
     * is replaced with a layout
     */
    replace(o, n) {
        this.cells.splice(this.cells.indexOf(o), 1, n)
    }
    /*
     * Adds a new pane. If the gate is connected the pane will open a
     * new data channel.
     * If index is given, the pane is replacing the one at that index
     */
    addPane(props, index = null) {
        // CONGRATS! a new pane is born. props must include at least sx & sy
        const p = props || {}
        p.w = this.w
        p.gate = this.gate
        p.layout = this
        p.channelID = props.channelID
        p.id = this.t7.cells.length
        const pane = new Pane(p)
        this.t7.cells.push(pane)

        if (props.parent instanceof Cell) {
            let parent = null
            this.cells.splice(this.cells.indexOf(props.parent)+1, 0, pane)
            if (props.parent && props.parent.d)
                parent = props.parent.d.id
            pane.openTerminal(parent, props)
        } else {
            if (typeof index == "number")
                this.cells.splice(index, 1, pane)
            else
                this.cells.push(pane)
            pane.openTerminal(null, props)
        }
        
        // opening the terminal and the datachannel are heavy so we wait
        // for 10 msecs to let the new layout refresh
        return pane
    }
    /*
     * waits a bit for the DOM to refresh and moves the dividers
     */
    refreshDividers() {
        this.t7.run(() => this.cells.forEach(c => {
            c.refreshDividers()
        }), ABIT)
    }

    toText() {
        // r is the text the function returns
        let r = (this.dir=="rightleft")?"[":"{"
        // get the dimensions of all the cell, recurse if a layout is found
        this.cells.forEach((c, i) => {
            if (i > 0)
                r += ','
            try {
                r += `${c.sx.toFixed(3)}x${c.sy.toFixed(3)}`
            }
            catch(e) {
                this.t7.log(i, c)
            }
            r += `,${c.xoff.toFixed(3)},${c.yoff.toFixed(3)}`
            if (c == this)
                this.t7.log("ERROR: layout shouldn't have `this` in his cells")
            // TODO: remove this workaround - `c != this`
            if ((c != this) && c instanceof Layout && (typeof c.toText == "function"))
                r += c.toText()
            else
                r += `,${c.id || (c as Pane).d.id}`
        })
        r += (this.dir=="rightleft")?"]":"}"
        return r
    }

    // Layout.dump dumps the layout to an object
    dump(): SerializedLayout {
        // r is the text the function returns
        const d: SerializedLayout = {
            dir: this.dir,
            sx: this.sx,
            sy: this.sy,
            xoff: this.xoff,
            yoff: this.yoff,
            cells: [],
        }
        // get the dimensions of all the cell, recurse if a layout is found
        this.cells.forEach(c => d.cells.push(c.dump()))
        return d
    }

    get sx() {
        return parseFloat(this.e.style.width.slice(0,-1)) / 100.0
    }
    /*
     * update the sx of the layout - resize the cells or spread them based on
     * the layout's direction.
     */
    set sx(val) {
        const oldS = this.sx,
            r = val/oldS
        this.e.style.width = String(val * 100) + "%"
        if (isNaN(r) || this.cells == undefined || this.cells.length == 0)
            return
        let off = this.cells[0].xoff
        this.cells.forEach((c) => {
            if (this.dir == "topbottom") {
                const oldS = c.sx,
                    s = oldS * r
                c.xoff = off
                c.sx = s
                off += s
            } else c.sx *= r
        })
    }
    get sy() {
        return parseFloat(this.e.style.height.slice(0,-1)) / 100.0
    }
    /*
     * update the sy of the layout - resize the cells or spread them based on
     * the layout's direction.
     */
    set sy(val) {
        const oldS = this.sy,
            r = val/oldS
        this.e.style.height = String(val * 100) + "%"
        if (isNaN(r) || this.cells == undefined || this.cells.length == 0)
            return
        let off = this.cells[0].yoff
        this.cells.forEach((c) => {
            if (this.dir == "rightleft") {
                const oldS = c.sy,
                    s = oldS * r
                c.yoff = off
                c.sy = s
                off += s
            } else c.sy *= r
        })
    }
    get xoff() {
        return parseFloat(this.e.style.left.slice(0,-1)) / 100.0
    }
    /*
     * Update the X offset for all cells
     */
    set xoff(val) {
        let x=val
        this.e.style.left = String(val * 100) + "%"
        if (this.cells !== undefined)
            this.cells.forEach((c) => {
                if (this.dir == "rightleft")
                    c.xoff = val
                else {
                    c.xoff = x
                    x += c.sx
                }
            })
    }
    get yoff() {
        return parseFloat(this.e.style.top.slice(0,-1)) / 100.0
    }
    /*
     * Update the Y offset for all cells
     */
    set yoff(val) {
        let y = val
        this.e.style.top = String(val * 100) + "%"
        if (this.cells !== undefined)
            this.cells.forEach((c) => {
                if (this.dir =="topbottom")
                    c.yoff = val
                else {
                    c.yoff = y
                    y += c.sy
                }
            })
    }
    prevCell(c) {
        const i = this.cells.indexOf(c) - 1
        return (i >= 0)?this.cells[i]:null
    }
    nextCell(c) {
        const i = this.cells.indexOf(c) + 1
        return (i < this.cells.length)?this.cells[i]:null
    }
    /*
     * Layout.moveBorder moves a pane's border
    * @param {Pane} pane - the pane to move the border in
    * @param {string} border - the border to move
    * @param {number} dest - the destination of the border
    * @param {boolean} fit - if true, fit the panes after moving the border
     */
    moveBorder(cell: Cell, border: string, dest: number, fit: boolean) {
        let s, off
        let c0 = null,
            c1 = null
        // first, check if it's a horizontal or vertical border we're moving
        if (border == "top" || border == "bottom") {
            s = "sy"
            off = "yoff"
        } else {
            s = "sx"
            off = "xoff"
        }
        if (this.dir.indexOf(border) == -1) {
            if (border == "top" || border == "left") {
                c0 = this.prevCell(cell)
                c1 = cell
                // if it's the first cell in the layout we need to get the layout's
                // layout to move the borderg
            } else {
                c0 = cell
                c1 = this.nextCell(cell)
            }
        }
        if (c0 == null || c1 == null) {
            if (this.layout)
                this.layout.moveBorder(this, border, dest, fit)
            return
        }
        // TODO: ensure cell is not forever in transit due to a lost event
        c0.transit = c1.transit = !fit
        const max = this.findNext(c1)
        dest = Math.max(dest, c0[off] + 0.02)
        dest = Math.min(dest, (max?.[off] || 1) - 0.02)
        const by = c1[off] - dest
        c0[s] -= by
        c1[s] += by
        c1[off] = dest
        c0.refreshDividers()
        c1.refreshDividers()
        if (fit) {
            c0.fit()
            c1.fit()
        }
        this.w.updateDivideButtons()
    }
    findNext(c) {
        if (this.nextCell(c))
            return this.nextCell(c)
        const root = this.layout?.layout
        if (root)
            return root.findNext(this.layout)
        return null
    }
    // Layout.allCells returns all the cells in the layout
    allCells() {
        let cells = []
        this.cells.forEach((c) => {
            if (c instanceof Layout)
                cells = cells.concat(c.allCells())
            else
                cells.push(c)
        })
        return cells
    }
    changeDir(){
        if(this.dir === "TBD") return;
        const parentDir = this.layout?.dir
        const newDir = this.dir === 'rightleft' ? 'topbottom' : 'rightleft'
        let keepXoff = false;
        let keepYoff = false;
        let cellSize;
        console.log('origdir',this.dir)
        if(this.dir === 'topbottom'){
            keepYoff = true
            cellSize = this.sy / this.cells.length
        }else if(this.dir === 'rightleft') {
            keepXoff = true
            cellSize = this.sx / this.cells.length
        }
        this.cells.forEach((c, i) => {
            const oldXoff = c.xoff
            const oldYoff = c.yoff
            const oldSx = c.sx;
            const oldSy = c.sy;
            c.yoff = oldXoff
            c.xoff = oldYoff
            c.sx = oldSy
            c.sy = oldSx
            // console.log('c',{
            //     xoff: c.xoff,
            //     yoff: c.yoff,
            //     sx: c.sx,
            //     sy: c.sy,
            // })
            if(keepYoff){
                c.yoff = this.yoff + cellSize * i
                c.xoff = this.xoff
                c.sy = cellSize
                c.sx = this.sx
            }else if(keepXoff){
                c.yoff = this.yoff
                c.xoff = this.xoff + cellSize * i
                c.sy = this.sy
                c.sx = cellSize
            }
            // console.log('c2',{
            //     xoff: c.xoff,
            //     yoff: c.yoff,
            //     sx: c.sx,
            //     sy: c.sy,
            // })
        });
        this.dir = newDir
        this.refreshDividers()
        if(this.dir === parentDir){
            const replaceIndex = this.layout.cells.findIndex(c => c.id === this.id)
            this.layout.cells.splice(replaceIndex, 1, ...this.cells)
            this.layout.refreshDividers()
        }
    }
}
