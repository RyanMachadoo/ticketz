import React, { useContext, useEffect, useReducer, useState } from "react";
import { toast } from "react-toastify";

import { makeStyles } from "@material-ui/core/styles";
import { green, red } from "@material-ui/core/colors";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from "@material-ui/core";
import {
  Block,
  CheckCircleOutline,
  Refresh,
  Settings
} from "@material-ui/icons";

import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import MainHeaderButtonsWrapper from "../../components/MainHeaderButtonsWrapper";
import Title from "../../components/Title";
import TableRowSkeleton from "../../components/TableRowSkeleton";
import ConfirmationModal from "../../components/ConfirmationModal";

import api from "../../services/api";
import { i18n } from "../../translate/i18n";
import toastError from "../../errors/toastError";
import { SocketContext } from "../../context/Socket/SocketContext";
import { AuthContext } from "../../context/Auth/AuthContext";

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
  blocked: {
    backgroundColor: red[600],
    color: "#fff"
  },
  active: {
    backgroundColor: green[600],
    color: "#fff"
  },
  overLimit: {
    color: red[700],
    fontWeight: 600
  },
  cost: {
    fontWeight: 600
  }
}));

const reducer = (state, action) => {
  if (action.type === "LOAD") {
    return action.payload;
  }
  if (action.type === "UPDATE") {
    const record = action.payload;
    const idx = state.findIndex(r => r.whatsappId === record.whatsappId);
    if (idx !== -1) {
      const copy = [...state];
      copy[idx] = record;
      return copy;
    }
    return [...state, record];
  }
  return state;
};

const emptyForm = {
  serviceMonthlyLimit: "",
  serviceFreeTier: "",
  priceService: "",
  priceMarketing: "",
  priceUtility: "",
  priceAuthentication: ""
};

const formatBRL = value =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  });

const WaUsage = () => {
  const classes = useStyles();
  const socketManager = useContext(SocketContext);
  const { user } = useContext(AuthContext);

  const [records, dispatch] = useReducer(reducer, []);
  const [period, setPeriod] = useState("");
  const [loading, setLoading] = useState(true);

  const [configOpen, setConfigOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingBlock, setPendingBlock] = useState(null);

  const isAdmin = user && user.profile === "admin";

  const fetchUsage = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/wa-usage");
      dispatch({ type: "LOAD", payload: data.records || [] });
      setPeriod(data.period || "");
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsage();
  }, []);

  useEffect(() => {
    const companyId = localStorage.getItem("companyId");
    if (!companyId || !socketManager) return undefined;
    // O SocketContext expõe GetSocket (G maiúsculo). Chamar getSocket
    // (inexistente) lançava TypeError e deixava a tela toda branca.
    const getSocketFn =
      socketManager.GetSocket || socketManager.getSocket;
    const socket =
      typeof getSocketFn === "function"
        ? getSocketFn.call(socketManager, companyId)
        : null;
    if (!socket) return undefined;

    const handler = data => {
      if (data.action === "update" && data.record) {
        dispatch({ type: "UPDATE", payload: data.record });
      }
    };
    socket.on(`company-${companyId}-waUsage`, handler);
    return () => {
      socket.off(`company-${companyId}-waUsage`, handler);
    };
  }, [socketManager]);

  const handleOpenConfig = record => {
    setSelected(record);
    setForm({
      serviceMonthlyLimit:
        record.limit === null || record.limit === undefined
          ? ""
          : String(record.limit),
      serviceFreeTier: String(record.freeTier ?? ""),
      priceService: String(record.prices?.service ?? ""),
      priceMarketing: String(record.prices?.marketing ?? ""),
      priceUtility: String(record.prices?.utility ?? ""),
      priceAuthentication: String(record.prices?.authentication ?? "")
    });
    setConfigOpen(true);
  };

  const handleCloseConfig = () => {
    setConfigOpen(false);
    setSelected(null);
    setForm(emptyForm);
  };

  const handleChange = field => e => {
    setForm({ ...form, [field]: e.target.value });
  };

  const handleSaveConfig = async () => {
    if (!selected) return;
    try {
      const payload = {
        serviceMonthlyLimit:
          form.serviceMonthlyLimit === "" ? null : Number(form.serviceMonthlyLimit),
        serviceFreeTier:
          form.serviceFreeTier === "" ? 0 : Number(form.serviceFreeTier),
        priceService: form.priceService === "" ? 0 : Number(form.priceService),
        priceMarketing:
          form.priceMarketing === "" ? 0 : Number(form.priceMarketing),
        priceUtility: form.priceUtility === "" ? 0 : Number(form.priceUtility),
        priceAuthentication:
          form.priceAuthentication === "" ? 0 : Number(form.priceAuthentication)
      };
      const { data } = await api.put(
        `/wa-usage/${selected.whatsappId}`,
        payload
      );
      dispatch({ type: "UPDATE", payload: data });
      toast.success(i18n.t("waUsage.toasts.configSaved"));
      handleCloseConfig();
    } catch (err) {
      toastError(err);
    }
  };

  const doBlock = async record => {
    try {
      const { data } = await api.post(`/wa-usage/${record.whatsappId}/block`);
      dispatch({ type: "UPDATE", payload: data });
      toast.success(i18n.t("waUsage.toasts.blocked"));
    } catch (err) {
      toastError(err);
    }
  };

  const doUnblock = async record => {
    try {
      const { data } = await api.post(`/wa-usage/${record.whatsappId}/unblock`);
      dispatch({ type: "UPDATE", payload: data });
      toast.success(i18n.t("waUsage.toasts.unblocked"));
    } catch (err) {
      toastError(err);
    }
  };

  const handleToggleBlock = record => {
    if (record.blocked) {
      doUnblock(record);
    } else {
      setPendingBlock(record);
      setConfirmOpen(true);
    }
  };

  const confirmBlock = () => {
    if (pendingBlock) doBlock(pendingBlock);
    setPendingBlock(null);
  };

  const renderStatus = record => {
    if (record.blocked) {
      return (
        <Chip
          size="small"
          className={classes.blocked}
          label={i18n.t("waUsage.status.blocked")}
        />
      );
    }
    if (record.overrideActive) {
      return (
        <Chip
          size="small"
          color="default"
          label={i18n.t("waUsage.status.released")}
        />
      );
    }
    return (
      <Chip
        size="small"
        className={classes.active}
        label={i18n.t("waUsage.status.active")}
      />
    );
  };

  return (
    <MainContainer>
      <ConfirmationModal
        title={i18n.t("waUsage.confirmBlockTitle")}
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmBlock}
      >
        {i18n.t("waUsage.confirmBlockMessage")}
      </ConfirmationModal>

      <Dialog open={configOpen} onClose={handleCloseConfig} maxWidth="sm" fullWidth>
        <DialogTitle>
          {i18n.t("waUsage.config.title")}
          {selected ? ` — ${selected.name}` : ""}
        </DialogTitle>
        <DialogContent dividers>
          <Typography
            variant="body2"
            color="textSecondary"
            className={classes.hint}
          >
            {i18n.t("waUsage.config.hint")}
          </Typography>
          <TextField
            label={i18n.t("waUsage.config.monthlyLimit")}
            helperText={i18n.t("waUsage.config.monthlyLimitHint")}
            type="number"
            fullWidth
            margin="dense"
            value={form.serviceMonthlyLimit}
            onChange={handleChange("serviceMonthlyLimit")}
          />
          <TextField
            label={i18n.t("waUsage.config.freeTier")}
            helperText={i18n.t("waUsage.config.freeTierHint")}
            type="number"
            fullWidth
            margin="dense"
            value={form.serviceFreeTier}
            onChange={handleChange("serviceFreeTier")}
          />
          <TextField
            label={i18n.t("waUsage.config.priceService")}
            type="number"
            fullWidth
            margin="dense"
            value={form.priceService}
            onChange={handleChange("priceService")}
          />
          <TextField
            label={i18n.t("waUsage.config.priceMarketing")}
            type="number"
            fullWidth
            margin="dense"
            value={form.priceMarketing}
            onChange={handleChange("priceMarketing")}
          />
          <TextField
            label={i18n.t("waUsage.config.priceUtility")}
            type="number"
            fullWidth
            margin="dense"
            value={form.priceUtility}
            onChange={handleChange("priceUtility")}
          />
          <TextField
            label={i18n.t("waUsage.config.priceAuthentication")}
            type="number"
            fullWidth
            margin="dense"
            value={form.priceAuthentication}
            onChange={handleChange("priceAuthentication")}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseConfig} color="secondary">
            {i18n.t("waUsage.config.cancel")}
          </Button>
          <Button onClick={handleSaveConfig} color="primary" variant="contained">
            {i18n.t("waUsage.config.save")}
          </Button>
        </DialogActions>
      </Dialog>

      <MainHeader>
        <Title>
          {i18n.t("waUsage.title")}
          {period ? ` (${period})` : ""}
        </Title>
        <MainHeaderButtonsWrapper>
          <IconButton onClick={fetchUsage} title={i18n.t("waUsage.refresh")}>
            <Refresh />
          </IconButton>
        </MainHeaderButtonsWrapper>
      </MainHeader>

      <Typography className={classes.hint} variant="body2" color="textSecondary">
        {i18n.t("waUsage.hint")}
      </Typography>

      <Paper className={classes.mainPaper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{i18n.t("waUsage.table.connection")}</TableCell>
              <TableCell align="center">
                {i18n.t("waUsage.table.serviceSent")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("waUsage.table.freeTier")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("waUsage.table.limit")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("waUsage.table.billable")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("waUsage.table.cost")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("waUsage.table.status")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("waUsage.table.actions")}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRowSkeleton columns={8} />
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography color="textSecondary">
                    {i18n.t("waUsage.empty")}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              records.map(r => {
                const overLimit =
                  r.limit !== null &&
                  r.limit !== undefined &&
                  r.serviceCount >= r.limit;
                return (
                  <TableRow key={r.whatsappId}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell
                      align="center"
                      className={overLimit ? classes.overLimit : undefined}
                    >
                      {r.serviceCount}
                    </TableCell>
                    <TableCell align="center">{r.freeTier}</TableCell>
                    <TableCell align="center">
                      {r.limit === null || r.limit === undefined
                        ? i18n.t("waUsage.noLimit")
                        : r.limit}
                    </TableCell>
                    <TableCell align="center">{r.serviceBillable}</TableCell>
                    <TableCell align="center" className={classes.cost}>
                      {formatBRL(r.cost?.total)}
                    </TableCell>
                    <TableCell align="center">{renderStatus(r)}</TableCell>
                    <TableCell align="center">
                      {isAdmin && (
                        <>
                          <Tooltip title={i18n.t("waUsage.actions.config")}>
                            <IconButton
                              size="small"
                              onClick={() => handleOpenConfig(r)}
                            >
                              <Settings />
                            </IconButton>
                          </Tooltip>
                          <Tooltip
                            title={
                              r.blocked
                                ? i18n.t("waUsage.actions.unblock")
                                : i18n.t("waUsage.actions.block")
                            }
                          >
                            <IconButton
                              size="small"
                              onClick={() => handleToggleBlock(r)}
                            >
                              {r.blocked ? (
                                <CheckCircleOutline
                                  style={{ color: green[600] }}
                                />
                              ) : (
                                <Block style={{ color: red[600] }} />
                              )}
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Paper>
    </MainContainer>
  );
};

export default WaUsage;
