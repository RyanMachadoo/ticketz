import React, { useContext, useEffect, useReducer, useState } from "react";
import { toast } from "react-toastify";

import { makeStyles } from "@material-ui/core/styles";
import { green } from "@material-ui/core/colors";
import {
  Button,
  Chip,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from "@material-ui/core";
import { DeleteOutline, Edit } from "@material-ui/icons";

import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import MainHeaderButtonsWrapper from "../../components/MainHeaderButtonsWrapper";
import Title from "../../components/Title";
import TableRowSkeleton from "../../components/TableRowSkeleton";
import ConfirmationModal from "../../components/ConfirmationModal";
import AIAgentModal from "../../components/AIAgentModal";

import api from "../../services/api";
import { i18n } from "../../translate/i18n";
import toastError from "../../errors/toastError";
import { SocketContext } from "../../context/Socket/SocketContext";

const useStyles = makeStyles(theme => ({
  mainPaper: {
    flex: 1,
    padding: theme.spacing(2),
    overflowY: "scroll",
    ...theme.scrollbarStyles
  },
  hint: {
    marginBottom: theme.spacing(2)
  },
  active: {
    backgroundColor: green[600],
    color: "#fff"
  }
}));

const reducer = (state, action) => {
  if (action.type === "LOAD") return action.payload;
  if (action.type === "UPDATE") {
    const record = action.payload;
    const idx = state.findIndex(r => r.id === record.id);
    if (idx !== -1) {
      const copy = [...state];
      copy[idx] = record;
      return copy;
    }
    return [record, ...state];
  }
  if (action.type === "DELETE") {
    return state.filter(r => r.id !== action.payload);
  }
  return state;
};

const AIAgents = () => {
  const classes = useStyles();
  const socketManager = useContext(SocketContext);

  const [agents, dispatch] = useReducer(reducer, []);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const fetchAgents = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/ai-agents");
      dispatch({ type: "LOAD", payload: Array.isArray(data) ? data : [] });
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  useEffect(() => {
    const companyId = localStorage.getItem("companyId");
    if (!companyId || !socketManager) return undefined;
    const socket = socketManager.getSocket
      ? socketManager.getSocket(companyId)
      : socketManager.GetSocket(companyId);
    if (!socket) return undefined;

    const handler = data => {
      if (data.action === "update" && data.record) {
        dispatch({ type: "UPDATE", payload: data.record });
      }
      if (data.action === "delete" && data.record) {
        dispatch({ type: "DELETE", payload: data.record.id });
      }
    };
    socket.on(`company-${companyId}-aiagent`, handler);
    return () => {
      socket.off(`company-${companyId}-aiagent`, handler);
    };
  }, [socketManager]);

  const handleOpenModal = (id = null) => {
    setSelectedId(id);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedId(null);
    fetchAgents();
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/ai-agents/${deletingId}`);
      toast.success(i18n.t("aiAgents.toasts.deleted"));
    } catch (err) {
      toastError(err);
    }
    setDeletingId(null);
    fetchAgents();
  };

  return (
    <MainContainer>
      <ConfirmationModal
        title={i18n.t("aiAgents.confirmDeleteTitle")}
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
      >
        {i18n.t("aiAgents.confirmDeleteMessage")}
      </ConfirmationModal>
      <AIAgentModal
        open={modalOpen}
        onClose={handleCloseModal}
        agentId={selectedId}
      />
      <MainHeader>
        <Title>{i18n.t("aiAgents.title")}</Title>
        <MainHeaderButtonsWrapper>
          <Button
            variant="contained"
            color="primary"
            onClick={() => handleOpenModal()}
          >
            {i18n.t("aiAgents.add")}
          </Button>
        </MainHeaderButtonsWrapper>
      </MainHeader>

      <Typography className={classes.hint} variant="body2" color="textSecondary">
        {i18n.t("aiAgents.hint")}
      </Typography>

      <Paper className={classes.mainPaper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{i18n.t("aiAgents.table.name")}</TableCell>
              <TableCell align="center">
                {i18n.t("aiAgents.table.model")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("aiAgents.table.queues")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("aiAgents.table.tools")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("aiAgents.table.active")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("aiAgents.table.actions")}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRowSkeleton columns={6} />
            ) : agents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography color="textSecondary">
                    {i18n.t("aiAgents.empty")}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              agents.map(a => (
                <TableRow key={a.id}>
                  <TableCell>{a.name}</TableCell>
                  <TableCell align="center">{a.model}</TableCell>
                  <TableCell align="center">
                    {(a.queues || []).map(q => (
                      <Chip
                        key={q.id}
                        size="small"
                        label={q.name}
                        style={{ margin: 2 }}
                      />
                    ))}
                    {(!a.queues || a.queues.length === 0) && (
                      <Typography variant="caption" color="textSecondary">
                        {i18n.t("aiAgents.noQueue")}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {(a.tools || []).length}
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      size="small"
                      className={a.isActive ? classes.active : undefined}
                      label={
                        a.isActive
                          ? i18n.t("aiAgents.statusActive")
                          : i18n.t("aiAgents.statusInactive")
                      }
                    />
                  </TableCell>
                  <TableCell align="center">
                    <IconButton
                      size="small"
                      onClick={() => handleOpenModal(a.id)}
                    >
                      <Edit />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => {
                        setDeletingId(a.id);
                        setConfirmOpen(true);
                      }}
                    >
                      <DeleteOutline />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
    </MainContainer>
  );
};

export default AIAgents;
