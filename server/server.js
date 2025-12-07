const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// 提供静态文件
app.use(express.static(path.join(__dirname, '../public')));

// 游戏状态
let gameState = {
    watchers: 0,
    totalPressure: 0,
    phase: 'waiting', // waiting, stable, unstable, critical, rupture, transmutation
    gazePoints: []
};

// Socket.io连接
io.on('connection', (socket) => {
    console.log('New connection:', socket.id);
    
    // 发送当前状态给新连接的用户
    socket.emit('initial-state', gameState);
    
    // 区分观众和体验者
    socket.on('join-as', (role) => {
        socket.role = role;
        console.log(`${socket.id} joined as ${role}`);
        
        if (role === 'audience') {
            gameState.watchers++;
            broadcastState();
        }
    });
    
    // 观众开始凝视
    socket.on('gaze-start', () => {
        if (socket.role !== 'audience') return;
        
        socket.isGazing = true;
        gameState.totalPressure += 2;
        
        // 添加凝视点（用于视觉效果）
        const gazePoint = {
            id: socket.id,
            angle: Math.random() * Math.PI * 2,
            intensity: 0.5
        };
        gameState.gazePoints.push(gazePoint);
        
        updatePhase();
        broadcastState();
    });
    
    // 观众持续凝视
    socket.on('gaze-hold', () => {
        if (!socket.isGazing) return;
        
        gameState.totalPressure += 0.5;
        
        // 更新对应的凝视点强度
        const gazePoint = gameState.gazePoints.find(g => g.id === socket.id);
        if (gazePoint) {
            gazePoint.intensity = Math.min(gazePoint.intensity + 0.1, 2);
        }
        
        updatePhase();
        broadcastState();
    });
    
    // 观众停止凝视
    socket.on('gaze-end', () => {
        socket.isGazing = false;
        
        // 移除凝视点
        gameState.gazePoints = gameState.gazePoints.filter(g => g.id !== socket.id);
        
        broadcastState();
    });
    
    // 触发转化（体验者按下按键）
    socket.on('trigger-transmutation', () => {
        if (socket.role !== 'experiencer') return;
        
        gameState.phase = 'transmutation';
        broadcastState();
        
        // 10秒后重置
        setTimeout(() => {
            resetGame();
        }, 10000);
    });
    
    // 断开连接
    socket.on('disconnect', () => {
        console.log('Disconnected:', socket.id);
        
        if (socket.role === 'audience') {
            gameState.watchers--;
            
            // 移除该观众的凝视点
            gameState.gazePoints = gameState.gazePoints.filter(g => g.id !== socket.id);
        }
        
        broadcastState();
    });
});

// 更新阶段
function updatePhase() {
    const p = gameState.totalPressure;
    
    if (p < 10) {
        gameState.phase = 'stable';
    } else if (p < 30) {
        gameState.phase = 'unstable';
    } else if (p < 60) {
        gameState.phase = 'critical';
    } else if (p >= 60) {
        gameState.phase = 'rupture';
        
        // 自动触发转化
        setTimeout(() => {
            gameState.phase = 'transmutation';
            broadcastState();
            
            // 之后重置
            setTimeout(() => {
                resetGame();
            }, 10000);
        }, 3000);
    }
}

// 广播状态给所有连接
function broadcastState() {
    io.emit('state-update', gameState);
}

// 重置游戏
function resetGame() {
    gameState = {
        watchers: gameState.watchers, // 保留观众数量
        totalPressure: 0,
        phase: 'waiting',
        gazePoints: []
    };
    broadcastState();
}

// 启动服务器
const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Audience view: http://localhost:${PORT}/audience.html`);
    console.log(`Main view: http://localhost:${PORT}/index.html`);
});